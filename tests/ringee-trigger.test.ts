import { describe, expect, it } from 'vitest';
import type { IHookFunctions, IWebhookFunctions, IWebhookResponseData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { RingeeTrigger, matchesFilters } from '../nodes/RingeeTrigger/RingeeTrigger.node';
import type { RingeeWebhookEnvelope } from '../lib/types';
import { signRingeeBody } from '../lib/utils/webhook';

const SECRET = 'whsec_' + 'c'.repeat(64);
const trigger = new RingeeTrigger();

function event(overrides: Partial<RingeeWebhookEnvelope> = {}): RingeeWebhookEnvelope {
	return {
		event: 'call.completed',
		eventId: 'evt_01',
		occurredAt: '2026-11-24T12:00:00.000Z',
		workspaceId: 'org_1',
		integrationId: 'ci_1',
		data: {
			callId: 'call-1',
			externalId: 'reminder-evt-9',
			agent: { id: 'agent-1', name: 'Sofia' },
			status: 'completed',
		},
		...overrides,
	};
}

interface Delivery {
	body?: string;
	headers?: Record<string, string | undefined>;
	signedAt?: number;
	secretToSignWith?: string;
}

function deliver(
	payload: RingeeWebhookEnvelope | string,
	options: {
		params?: Record<string, unknown>;
		secret?: string;
		mode?: 'manual' | 'trigger';
		staticData?: Record<string, unknown>;
		delivery?: Delivery;
		omitRawBody?: boolean;
	} = {},
) {
	const body =
		options.delivery?.body ?? (typeof payload === 'string' ? payload : JSON.stringify(payload));
	const signature = signRingeeBody(
		body,
		options.delivery?.secretToSignWith ?? SECRET,
		options.delivery?.signedAt,
	);
	const headers: Record<string, string | undefined> = {
		'ringee-signature': signature,
		...options.delivery?.headers,
	};
	const sent: { status?: number; json?: { message: string } } = {};
	const staticData = options.staticData ?? {};

	const ctx = {
		getRequestObject: () => ({
			headers,
			rawBody: options.omitRawBody ? undefined : Buffer.from(body),
		}),
		getResponseObject: () => ({
			status(code: number) {
				sent.status = code;
				return { json: (value: { message: string }) => (sent.json = value) };
			},
		}),
		getBodyData: () => JSON.parse(body),
		getNodeParameter: (name: string, fallback?: unknown) => options.params?.[name] ?? fallback,
		getCredentials: async () => ({ signingSecret: options.secret ?? SECRET }),
		getMode: () => options.mode ?? 'trigger',
		getWorkflowStaticData: () => staticData,
		getNode: () => ({ name: 'Ringee Trigger' }),
	} as unknown as IWebhookFunctions;

	return trigger.webhook
		.call(ctx)
		.then((result: IWebhookResponseData) => ({ result, sent, staticData }));
}

const listening = (...events: string[]) => ({ events });

describe('Ringee Trigger: accepting events', () => {
	it('starts the workflow with the event exactly as Ringee sent it', async () => {
		const { result, sent } = await deliver(event(), { params: listening('call.completed') });
		expect(sent.status).toBeUndefined();
		expect(result.workflowData?.[0][0].json).toEqual(event());
	});

	it('keeps text that is not ASCII intact', async () => {
		const spanish = event({
			data: { callId: 'c', transcript: '¿Puede asistir mañana? Sí, claro 👍' },
		});
		const { result } = await deliver(spanish, { params: listening('call.completed') });
		expect(result.workflowData?.[0][0].json).toEqual(spanish);
	});

	it('acknowledges events the workflow did not ask for, without running it', async () => {
		const { result } = await deliver(event({ event: 'note.created' }), {
			params: listening('call.completed'),
		});
		expect(result.workflowData).toBeUndefined();
		expect(result.webhookResponse).toMatchObject({ received: true, message: 'event ignored' });
	});
});

describe('Ringee Trigger: refusing what is not Ringee', () => {
	const refused = (r: Awaited<ReturnType<typeof deliver>>, status: number) => {
		expect(r.sent.status).toBe(status);
		expect(r.result.noWebhookResponse).toBe(true);
		expect(r.result.workflowData).toBeUndefined();
	};

	it('refuses a delivery signed with another secret', async () => {
		refused(
			await deliver(event(), {
				params: listening('call.completed'),
				delivery: { secretToSignWith: 'whsec_attacker' },
			}),
			401,
		);
	});

	it('refuses a delivery with no signature', async () => {
		refused(
			await deliver(event(), {
				params: listening('call.completed'),
				delivery: { headers: { 'ringee-signature': undefined } },
			}),
			401,
		);
	});

	it('refuses a body that was changed after it was signed', async () => {
		const original = JSON.stringify(event());
		const forged = original.replace('call-1', 'call-2');
		const signature = signRingeeBody(original, SECRET);
		refused(
			await deliver(event(), {
				params: listening('call.completed'),
				delivery: { body: forged, headers: { 'ringee-signature': signature } },
			}),
			401,
		);
	});

	it('refuses a signed delivery that is too old', async () => {
		refused(
			await deliver(event(), {
				params: listening('call.completed'),
				delivery: { signedAt: Date.now() - 10 * 60 * 1000 },
			}),
			401,
		);
	});

	it('accepts an older one when the user widened the window', async () => {
		const r = await deliver(event(), {
			params: { ...listening('call.completed'), options: { maxAgeSeconds: 1800 } },
			delivery: { signedAt: Date.now() - 10 * 60 * 1000 },
		});
		expect(r.result.workflowData).toBeDefined();
	});

	it('accepts nothing when the credential has no signing secret, and says why', async () => {
		const r = await deliver(event(), { params: listening('call.completed'), secret: '' });
		refused(r, 401);
		expect(r.sent.json?.message).toMatch(/Webhook Signing Secret/);
	});

	it('refuses when the raw body is not available to verify', async () => {
		refused(
			await deliver(event(), { params: listening('call.completed'), omitRawBody: true }),
			400,
		);
	});

	it('refuses a correctly signed body that is not a Ringee event', async () => {
		refused(await deliver('{"hello":"world"}', { params: listening('call.completed') }), 400);
		refused(await deliver('[1,2,3]', { params: listening('call.completed') }), 400);
		refused(
			await deliver('{"event":"call.completed","eventId":"e"}', {
				params: listening('call.completed'),
			}),
			400,
		);
	});

	it('verifies before it looks at anything else', async () => {
		// An unsigned request for an ignored event is refused, not acknowledged.
		const r = await deliver(event({ event: 'note.created' }), {
			params: listening('call.completed'),
			delivery: { headers: { 'ringee-signature': undefined } },
		});
		refused(r, 401);
	});
});

describe('Ringee Trigger: repeated events', () => {
	it('runs once for an event Ringee sends twice', async () => {
		const staticData = {};
		const params = listening('call.completed');
		const first = await deliver(event(), { params, staticData });
		const second = await deliver(event(), { params, staticData });
		expect(first.result.workflowData).toBeDefined();
		expect(second.result.workflowData).toBeUndefined();
		expect(second.result.webhookResponse).toMatchObject({ message: 'duplicate event' });
	});

	it('runs for two different events', async () => {
		const staticData = {};
		const params = listening('call.completed');
		await deliver(event({ eventId: 'evt_a' }), { params, staticData });
		const other = await deliver(event({ eventId: 'evt_b' }), { params, staticData });
		expect(other.result.workflowData).toBeDefined();
	});

	it('runs for every delivery when told not to ignore duplicates', async () => {
		const staticData = {};
		const params = { ...listening('call.completed'), options: { ignoreDuplicates: false } };
		await deliver(event(), { params, staticData });
		const again = await deliver(event(), { params, staticData });
		expect(again.result.workflowData).toBeDefined();
	});

	it('does not remember events it filtered out', async () => {
		const staticData = {};
		await deliver(event(), {
			params: { ...listening('call.completed'), options: { onlyAiAgentCalls: true } },
			staticData: staticData,
		});
		expect(Object.keys((staticData as { seen?: object }).seen ?? {})).toHaveLength(1);
		const human = event({ eventId: 'evt_h', data: { callId: 'x' } });
		await deliver(human, {
			params: { ...listening('call.completed'), options: { onlyAiAgentCalls: true } },
			staticData,
		});
		expect(Object.keys((staticData as { seen: object }).seen)).toEqual(['evt_01']);
	});
});

describe('Ringee Trigger: filters', () => {
	it('can react only to calls an AI voice agent made', () => {
		const human = event({ data: { callId: 'c' } });
		expect(matchesFilters(event(), { onlyAiAgentCalls: true })).toBe(true);
		expect(matchesFilters(human, { onlyAiAgentCalls: true })).toBe(false);
		expect(matchesFilters(human, {})).toBe(true);
	});

	it('can react only to one agent', () => {
		expect(matchesFilters(event(), { agentId: { value: 'agent-1' } })).toBe(true);
		expect(matchesFilters(event(), { agentId: { value: 'agent-2' } })).toBe(false);
		expect(matchesFilters(event(), { agentId: 'agent-1' })).toBe(true);
		expect(matchesFilters(event(), { agentId: { value: '' } })).toBe(true);
	});

	it('can react only to calls started with an external id prefix', () => {
		expect(matchesFilters(event(), { externalIdPrefix: 'reminder-' })).toBe(true);
		expect(matchesFilters(event(), { externalIdPrefix: 'lead-' })).toBe(false);
		expect(
			matchesFilters(event({ data: { callId: 'c' } }), { externalIdPrefix: 'reminder-' }),
		).toBe(false);
		expect(matchesFilters(event(), { externalIdPrefix: '  ' })).toBe(true);
	});

	it('applies filters before running the workflow', async () => {
		const r = await deliver(event(), {
			params: { ...listening('call.completed'), options: { externalIdPrefix: 'lead-' } },
		});
		expect(r.result.workflowData).toBeUndefined();
		expect(r.result.webhookResponse).toMatchObject({ message: 'event filtered out' });
	});
});

describe('Ringee Trigger: Send test from Ringee', () => {
	const ping = event({
		event: 'test.ping',
		eventId: 'evt_test_1',
		data: { message: 'Hello from Ringee custom integrations.' },
	});

	it('shows the test event while the user is building the workflow', async () => {
		const r = await deliver(ping, { params: listening('call.completed'), mode: 'manual' });
		expect(r.result.workflowData?.[0][0].json.event).toBe('test.ping');
	});

	it('never starts an active workflow', async () => {
		const r = await deliver(ping, { params: listening('call.completed'), mode: 'trigger' });
		expect(r.result.workflowData).toBeUndefined();
		expect(r.result.webhookResponse).toMatchObject({ received: true });
	});

	it('still requires a valid signature', async () => {
		const r = await deliver(ping, {
			params: listening('call.completed'),
			mode: 'manual',
			delivery: { secretToSignWith: 'whsec_other' },
		});
		expect(r.sent.status).toBe(401);
	});
});

describe('Ringee Trigger: activation', () => {
	const hookContext = (signingSecret: unknown) =>
		({
			getCredentials: async () => ({ signingSecret }),
			getNode: () => ({ name: 'Ringee Trigger' }),
		}) as unknown as IHookFunctions;
	const lifecycle = trigger.webhookMethods.default;

	it('asks for the signing secret when the workflow is switched on', async () => {
		for (const missing of [undefined, '', '   ']) {
			const attempt = lifecycle.create.call(hookContext(missing));
			await expect(attempt).rejects.toBeInstanceOf(NodeOperationError);
			await expect(attempt).rejects.toThrow(/no Webhook Signing Secret/);
		}
	});

	it('activates when the secret is there, and has nothing to remove on Ringee when switched off', async () => {
		expect(await lifecycle.create.call(hookContext(SECRET))).toBe(true);
		expect(await lifecycle.delete.call(hookContext(SECRET))).toBe(true);
		// Always "not registered yet", so the check above runs on every activation.
		expect(await lifecycle.checkExists.call(hookContext(SECRET))).toBe(false);
	});
});
