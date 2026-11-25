import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { INodeExecutionData } from 'n8n-workflow';
import { Ringee } from '../nodes/Ringee/Ringee.node';
import { forgetCapabilities } from '../lib/api/capabilities';
import { MOCK_AGENT_ID, MockRingee } from './helpers/mock-ringee';
import { makeContext, unexpectedSuccess, type ContextOptions } from './helpers/context';
import { assignmentsOf, evaluate, loadTemplates, startsCalls } from './helpers/templates';

/**
 * Start Call when Ringee has to wait for call capacity (CPS-006): the call is
 * accepted, not dialed, and says so; it can be read, cancelled, replayed and
 * batched; and a full queue is refused at once instead of being retried blindly.
 */
const mock = new MockRingee();
beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => {
	mock.reset();
	forgetCapabilities();
});

const node = new Ringee();
const agentRl = { mode: 'list', value: MOCK_AGENT_ID };

async function run(
	params: Record<string, unknown>,
	options: Partial<ContextOptions> = {},
): Promise<INodeExecutionData[]> {
	const { ctx } = makeContext({ baseUrl: mock.baseUrl, params, ...options });
	const [out] = await node.execute.call(ctx);
	return out;
}

const start = (extra: Record<string, unknown> = {}) => ({
	resource: 'aiAgent',
	operation: 'startCall',
	agentId: agentRl,
	phoneNumber: '+14155550123',
	variables: {
		mappingMode: 'defineBelow',
		value: { first_name: 'Ada', notification: 'Demo' },
	},
	options: {},
	...extra,
});
const read = (callId: unknown, operation = 'getCallStatus') => ({
	resource: 'aiAgent',
	operation,
	callId,
});
const cancel = (callId: unknown) => ({ resource: 'aiAgent', operation: 'cancelCall', callId });
const posts = () => mock.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/calls'));

describe('a call that has to wait for call capacity', () => {
	it('is reported as queued, not as started, and nothing is dialed', async () => {
		mock.queueNext = 1;
		const [item] = await run(start());
		expect(item.json).toMatchObject({ status: 'queued', queued: true, finished: false });
		expect(typeof item.json.call_id).toBe('string');
		expect(typeof item.json.queued_at).toBe('string');
		expect(Date.parse(item.json.expires_at as string)).toBeGreaterThan(Date.now());
		expect(mock.placedCalls).toBe(0);
	});

	it('answers an idle Ringee exactly as before: initiating, not queued', async () => {
		const [item] = await run(start());
		expect(item.json).toMatchObject({ status: 'initiating', queued: false, finished: false });
		expect(item.json).not.toHaveProperty('queued_at');
		expect(item.json).not.toHaveProperty('expires_at');
		expect(mock.placedCalls).toBe(1);
	});

	it('shows as queued while it waits, then as dialing once it is placed', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		const callId = started.json.call_id as string;

		const [waiting] = await run(read(callId));
		expect(waiting.json).toMatchObject({ status: 'queued', queued: true, finished: false });

		mock.dispatchQueued(callId);
		const [dialing] = await run(read(callId));
		expect(dialing.json).toMatchObject({ status: 'initiating', queued: false, finished: false });
		expect(mock.placedCalls).toBe(1);
	});

	it('Get Call Result says the same: no outcome yet, and that it is queued', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		const [result] = await run(read(started.json.call_id, 'getCallResult'));
		expect(result.json).toMatchObject({
			status: 'queued',
			queued: true,
			finished: false,
			outcome: null,
		});
	});

	it('is final, and never dialed, when it expires', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		const callId = started.json.call_id as string;
		mock.expireQueued(callId);
		const [after] = await run(read(callId));
		expect(after.json).toMatchObject({ status: 'expired', finished: true, queued: false });
		expect(mock.placedCalls).toBe(0);
	});
});

describe('Cancel Call', () => {
	it('withdraws a call that has not been dialed', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		const [cancelled] = await run(cancel(started.json.call_id));
		expect(cancelled.json).toMatchObject({
			call_id: started.json.call_id,
			status: 'cancelled',
			finished: true,
			queued: false,
		});
		const [after] = await run(read(started.json.call_id));
		expect(after.json.status).toBe('cancelled');
		expect(mock.placedCalls).toBe(0);
	});

	it('cannot cancel a call that is already dialing, and says why', async () => {
		const [started] = await run(start());
		const error = await run(cancel(started.json.call_id)).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toMatch(/can no longer be cancelled/i);
		expect(String(error.description)).toMatch(/hung up in Ringee/);
	});

	it('answers a second cancel with the same refusal, not a second cancellation', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		await run(cancel(started.json.call_id));
		const error = await run(cancel(started.json.call_id)).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error.httpCode).toBe('409');
	});

	it('says a call is not found, and asks for the ID when it is empty', async () => {
		const missing = await run(cancel('00000000-0000-4000-8000-000000000000')).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(missing.httpCode).toBe('404');
		const empty = await run(cancel('')).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeOperationError,
		);
		expect(empty).toBeInstanceOf(NodeOperationError);
		expect(empty.message).toMatch(/Enter the ID of the call/);
	});

	it('is refused, before anything is sent, by a Ringee that cannot cancel', async () => {
		mock.queueNext = 1;
		const [started] = await run(start());
		forgetCapabilities();
		mock.capabilities = {
			apiVersion: 1,
			capabilities: { agentDetail: true, contacts: true, calls: true, idempotentCalls: true },
		};
		const before = mock.requests.length;
		const error = await run(cancel(started.json.call_id)).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeOperationError,
		);
		expect(error.message).toMatch(/too old/);
		expect(String(error.description)).toMatch(/cancel a call that is waiting/);
		expect(mock.requests.slice(before).filter((r) => r.path.endsWith('/cancel'))).toHaveLength(0);
	});
});

describe('repeating a request whose call waited, was withdrawn, or gave up', () => {
	const sameAttempt = { workflowId: 'wf-q', executionId: '501', nodeId: 'n1' };

	it('answers a repeat of a queued request with the same queued call', async () => {
		mock.queueNext = 1;
		const [first] = await run(start(), sameAttempt);
		const [again] = await run(start(), sameAttempt);
		expect(again.json.call_id).toBe(first.json.call_id);
		expect(again.json).toMatchObject({ status: 'queued', queued: true, idempotent_replayed: true });
		expect(mock.agentCalls.size).toBe(1);
	});

	it('does not quietly place a call that was cancelled', async () => {
		mock.queueNext = 1;
		const [first] = await run(start(), sameAttempt);
		await run(cancel(first.json.call_id));
		const error = await run(start(), sameAttempt).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error.httpCode).toBe('409');
		expect(String(error.description)).toMatch(/Give the call a new Idempotency Key/);
		expect(mock.placedCalls).toBe(0);
	});

	it('does not quietly place a call that expired', async () => {
		mock.queueNext = 1;
		const [first] = await run(start(), sameAttempt);
		mock.expireQueued(first.json.call_id as string);
		const error = await run(start(), sameAttempt).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error.httpCode).toBe('409');
		expect(mock.placedCalls).toBe(0);
	});
});

describe('a queue that is full', () => {
	it('is raised at once, not retried: it clears when calls finish, not in a second', async () => {
		mock.queueFull = true;
		const error = await run(start()).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.httpCode).toBe('429');
		expect(error.message).toMatch(/calls waiting for call capacity/i);
		expect(String(error.description)).toMatch(/Nothing was queued and nothing was dialed/);
		expect(String(error.description)).toMatch(/30 seconds/);
		expect(String(error.description)).toMatch(/same Idempotency Key/);
		// One request, not three: the API's own rate limit is retried, this is not.
		expect(posts()).toHaveLength(1);
	});

	it('is retried by a new execution, with the same key, once it has cleared', async () => {
		const sameAttempt = { workflowId: 'wf-q', executionId: '777', nodeId: 'n1' };
		mock.queueFull = true;
		await run(start(), sameAttempt).catch(() => undefined);
		mock.queueFull = false;
		const [item] = await run(start(), sameAttempt);
		expect(item.json.status).toBe('initiating');
		expect(mock.placedCalls).toBe(1);
	});

	it('lets a batch carry on past it, naming the item, when asked to', async () => {
		const items = [{ json: { phone: '+14155550101' } }, { json: { phone: '+14155550102' } }];
		mock.queueNext = 1;
		const out = await run(start({ phoneNumber: (i: number) => items[i].json.phone }), {
			items,
			continueOnFail: true,
		});
		expect(out).toHaveLength(2);
		expect(out[0].json).toMatchObject({ status: 'queued', queued: true });
		expect(out[1].json).toMatchObject({ status: 'initiating', queued: false });
		expect(out[1].pairedItem).toEqual({ item: 1 });
	});

	it('still retries the API rate limit the way it always did', async () => {
		mock.failNext.push({
			method: 'POST',
			pathStartsWith: '/api/v1/ai-voice-agents',
			status: 429,
			headers: { 'retry-after': '0' },
			body: { statusCode: 429, message: 'Too many requests for this integration.' },
		});
		const [item] = await run(start());
		expect(item.json.status).toBe('initiating');
		expect(posts().length).toBeGreaterThanOrEqual(2);
	});
});

describe('a deferral is not an API rate limit either', () => {
	it('is raised at once with its own explanation', async () => {
		mock.failNext.push({
			method: 'POST',
			pathStartsWith: '/api/v1/ai-voice-agents',
			status: 429,
			body: {
				statusCode: 429,
				code: 'dispatch_deferred',
				reason: 'busy',
				retryAfterMs: 4000,
				message: 'Outbound call capacity is fully used (busy).',
			},
		});
		const error = await run(start()).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toMatch(/no call capacity free/i);
		expect(String(error.description)).toMatch(/4 seconds/);
		expect(posts()).toHaveLength(1);
	});
});

describe('durable queue deadlines and large batches', () => {
	it('preserves the original deadline on replay, status and result', async () => {
		mock.queueNext = 1;
		const same = { workflowId: 'wf-deadline', executionId: 'same-execution', nodeId: 'call-node' };
		const [first] = await run(start(), same);
		const [again] = await run(start(), same);
		const [status] = await run(read(first.json.call_id));
		const [result] = await run(read(first.json.call_id, 'getCallResult'));
		for (const item of [again, status, result]) {
			expect(item.json.expires_at).toBe(first.json.expires_at);
			expect(item.json.queued_at).toBe(first.json.queued_at);
		}
		expect(mock.agentCalls.size).toBe(1);
		expect(mock.placedCalls).toBe(0);
	});

	it('returns 1,000 durable queued operations without waiting for provider dispatch', async () => {
		mock.queueNext = 1000;
		const items = Array.from({ length: 1000 }, (_, id) => ({ json: { id } }));
		const out = await run(
			start({ options: (i: number) => ({ idempotencyKey: 'batch-record-' + i }) }),
			{ items },
		);
		expect(out).toHaveLength(1000);
		expect(new Set(out.map((item) => item.json.call_id)).size).toBe(1000);
		expect(
			out.every((item) => item.json.queued === true && typeof item.json.expires_at === 'string'),
		).toBe(true);
		expect(mock.placedCalls).toBe(0);
	}, 30000);
});

describe('persistent record keys', () => {
	it('replays a queued record across separate executions without another operation', async () => {
		mock.queueNext = 1;
		const params = start({ options: { idempotencyKey: 'lead-record-123' } });
		const [first] = await run(params, { executionId: 'execution-one' });
		const [again] = await run(params, { executionId: 'execution-two' });
		expect(again.json.call_id).toBe(first.json.call_id);
		expect(again.json.idempotent_replayed).toBe(true);
		expect(mock.agentCalls.size).toBe(1);
		expect(mock.placedCalls).toBe(0);
	});
});

/**
 * The templates' queue watcher is only as good as what the node hands it. These
 * run the real Start Call handler against the mock API and feed its output to
 * the template's own expressions, so a handler that dropped `expires_at`, or an
 * answer the selector cannot place, fails here and not in someone's workflow.
 */
const watchers = loadTemplates().filter((template) => template.has('Was the operation queued?'));

describe('the queue watcher of every template', () => {
	it('exists in every template that starts calls with the Ringee node', () => {
		expect(watchers.map((template) => template.file)).toEqual(
			loadTemplates()
				.filter(startsCalls)
				.map((template) => template.file),
		);
		expect(watchers.length).toBeGreaterThan(0);
	});

	describe.each(watchers.map((template) => [template.file, template] as const))(
		'%s',
		(_file, template) => {
			it('keeps the deadline Start Call returned, and waits until it', async () => {
				mock.queueWindowMs = 10 * 60_000;
				mock.queueNext = 1;
				const sameAttempt = { workflowId: 'wf-watch', executionId: '900', nodeId: 'call' };
				const [queued] = await run(start(), sameAttempt);
				// A retry under the same key (a re-run, a Retry On Fail) answers the same window.
				const [replayed] = await run(start(), sameAttempt);
				expect(replayed.json.idempotent_replayed).toBe(true);

				const queuedAt = Date.parse(queued.json.queued_at as string);
				for (const answer of [queued, replayed]) {
					const remembered = assignmentsOf(template.node('Remember queued operation'), {
						$json: answer.json,
					});
					expect(remembered).toEqual({
						call_id: queued.json.call_id,
						expires_at: queued.json.expires_at,
					});
					expect(Date.parse(remembered.expires_at as string) - queuedAt).toBe(10 * 60_000);
					// Ten minutes from when it was queued, plus the one second the template adds.
					const seconds = evaluate(template.node('Wait until queue deadline').parameters.amount, {
						$input: { all: () => [{ json: remembered }] },
						Date: { now: () => queuedAt, parse: Date.parse },
						Math,
					});
					expect(seconds).toBe(601);
				}
			});

			it('only receives calls that wait or were dialed: a repeat of one that never dialed is an error', async () => {
				const condition = (
					template.node('Was the operation queued?').parameters.conditions as {
						conditions: Array<{ leftValue: string; rightValue: string }>;
					}
				).conditions[0];
				const selects = (json: unknown) =>
					evaluate(condition.leftValue, { $json: json }) === condition.rightValue;
				const attempt = (nodeId: string) => ({ workflowId: 'wf-select', executionId: '1', nodeId });

				// Still waiting, however often it is asked for: the watcher follows it.
				mock.queueNext = 1;
				const [waiting] = await run(start(), attempt('waiting'));
				const [waitingAgain] = await run(start(), attempt('waiting'));
				expect(waitingAgain.json.idempotent_replayed).toBe(true);
				expect(selects(waiting.json)).toBe(true);
				expect(selects(waitingAgain.json)).toBe(true);

				// Dialed: its events and result belong to the other branch.
				const [placed] = await run(start(), attempt('placed'));
				const [placedAgain] = await run(start(), attempt('placed'));
				expect(placedAgain.json).toMatchObject({ status: 'initiating', idempotent_replayed: true });
				expect(selects(placed.json)).toBe(false);
				expect(selects(placedAgain.json)).toBe(false);

				// Withdrawn, or gave up: Ringee answers a repeat with 409 and a code, so the answer never
				// reaches the selector at all — Start Call's error output (or a failed run) reports it.
				for (const end of ['cancelled', 'expired'] as const) {
					mock.queueNext = 1;
					const [queued] = await run(start(), attempt(end));
					if (end === 'expired') mock.expireQueued(queued.json.call_id as string);
					else await run(cancel(queued.json.call_id));
					const error = await run(start(), attempt(end)).then(
						unexpectedSuccess,
						(e: unknown) => e as NodeApiError,
					);
					expect(error.httpCode, end).toBe('409');
				}
				expect(mock.placedCalls).toBe(1);
			});
		},
	);
});
