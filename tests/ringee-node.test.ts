/* eslint-disable @n8n/community-nodes/no-hardcoded-secrets -- idempotency keys in these tests are examples, not secrets */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { Ringee } from '../nodes/Ringee/Ringee.node';
import { forgetCapabilities } from '../lib/api/capabilities';
import { getAgents, getCallerNumbers, getContacts } from '../nodes/Ringee/methods/listSearch';
import { getAgentVariables } from '../nodes/Ringee/methods/resourceMapping';
import { MOCK_AGENT_ID, MOCK_NUMBER_ID, MockRingee } from './helpers/mock-ringee';
import { jsonOf, makeContext, unexpectedSuccess, type ContextOptions } from './helpers/context';

const mock = new MockRingee();
beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => {
	mock.reset();
	forgetCapabilities();
});

const node = new Ringee();

async function run(
	params: Record<string, unknown>,
	options: Partial<ContextOptions> = {},
): Promise<INodeExecutionData[]> {
	const { ctx } = makeContext({ baseUrl: mock.baseUrl, params, ...options });
	const [out] = await node.execute.call(ctx);
	return out;
}

const agentRl = { mode: 'list', value: MOCK_AGENT_ID };

describe('AI Voice Agent', () => {
	it('lists agents, all of them across pages', async () => {
		mock.agents = Array.from({ length: 230 }, (_, i) => ({
			...mock.agents[0],
			id: `a${i}`,
			name: `Agent ${i}`,
		}));
		const out = await run({
			resource: 'aiAgent',
			operation: 'getMany',
			returnAll: true,
			filters: {},
		});
		expect(out).toHaveLength(230);
		expect(out[0].pairedItem).toEqual({ item: 0 });
	});

	it('limits the list and passes the type filter on', async () => {
		const out = await run({
			resource: 'aiAgent',
			operation: 'getMany',
			returnAll: false,
			limit: 1,
			filters: { type: 'reminders_notifications' },
		});
		expect(out).toHaveLength(1);
		expect(mock.requests[0].query).toMatchObject({ type: 'reminders_notifications', limit: '1' });
	});

	it('gets one agent with the variables its calls accept', async () => {
		const [item] = await run({ resource: 'aiAgent', operation: 'get', agentId: agentRl });
		expect(item.json.name).toBe('Sofia Reminder Agent');
		expect((item.json.variables as unknown[]).length).toBe(3);
	});

	describe('Start Call', () => {
		const startParams = (extra: Record<string, unknown> = {}) => ({
			resource: 'aiAgent',
			operation: 'startCall',
			agentId: agentRl,
			phoneNumber: '+1 (415) 555-0123',
			variables: {
				mappingMode: 'defineBelow',
				value: { first_name: 'Ada', notification: 'Product demo', appointment_date: '' },
			},
			options: {},
			...extra,
		});

		it('returns the call id and status at once, without waiting for the call', async () => {
			const [item] = await run(startParams());
			expect(item.json).toMatchObject({ status: 'initiating', finished: false });
			expect(typeof item.json.call_id).toBe('string');
			expect(mock.placedCalls).toBe(1);
		});

		it('sends the number cleaned, the variables as text and no empty ones', async () => {
			await run(
				startParams({ options: { callerNumberId: { mode: 'list', value: MOCK_NUMBER_ID } } }),
			);
			expect(mock.requests[0].body).toEqual({
				to: '+14155550123',
				from_number_id: MOCK_NUMBER_ID,
				variables: { first_name: 'Ada', notification: 'Product demo' },
			});
		});

		it('merges External ID into the metadata Ringee echoes back on events', async () => {
			await run(
				startParams({ options: { externalId: 'calendar-evt-9', metadata: '{"crm_id":"42"}' } }),
			);
			expect(mock.requests[0].body?.metadata).toEqual({
				crm_id: '42',
				external_id: 'calendar-evt-9',
			});
		});

		it('refuses metadata that is not a JSON object, before dialing', async () => {
			for (const metadata of ['[1,2]', 'not json', '"text"']) {
				await expect(run(startParams({ options: { metadata } }))).rejects.toThrow(
					/must be a JSON object/,
				);
			}
			expect(mock.requests).toHaveLength(0);
		});

		it('refuses an unusable number before dialing, naming the field', async () => {
			const error = await run(startParams({ phoneNumber: 'call me' })).then(
				unexpectedSuccess,
				(e: unknown) => e as NodeOperationError,
			);
			expect(error).toBeInstanceOf(NodeOperationError);
			expect(error.message).toMatch(/not a phone number/);
			expect(error.description).toMatch(/Phone Number/);
			expect(mock.requests).toHaveLength(0);
		});

		describe('idempotency', () => {
			it('sends a key that names this attempt when the user chose none', async () => {
				await run(startParams(), { workflowId: 'wf-7', executionId: '991', nodeId: 'node-A' });
				expect(mock.requests[0].headers['idempotency-key']).toBe('n8n:wf-7:991:node-A:r0:i0');
			});

			it('places the call once when the same attempt is repeated (Retry On Fail, timeout)', async () => {
				const sameAttempt = { workflowId: 'wf-7', executionId: '991', nodeId: 'node-A' };
				const [first] = await run(startParams(), sameAttempt);
				const [again] = await run(startParams(), sameAttempt);

				expect(mock.placedCalls).toBe(1);
				expect(again.json.call_id).toBe(first.json.call_id);
				expect(again.json.idempotent_replayed).toBe(true);
				expect(first.json.idempotent_replayed).toBe(false);
			});

			it('places a new call for a new run of the node, as a Loop Over Items does', async () => {
				const base = { workflowId: 'wf-7', executionId: '991', nodeId: 'node-A' };
				await run(startParams(), { ...base, runIndex: 0 });
				await run(startParams(), { ...base, runIndex: 1 });
				expect(mock.placedCalls).toBe(2);
			});

			it('places a new call for a new execution', async () => {
				await run(startParams(), { workflowId: 'wf-7', executionId: '991' });
				await run(startParams(), { workflowId: 'wf-7', executionId: '992' });
				expect(mock.placedCalls).toBe(2);
			});

			it("uses the user's own key, which protects across executions", async () => {
				const options = { options: { idempotencyKey: 'reminder-evt_123' } };
				const [first] = await run(startParams(options), { executionId: '1' });
				const [second] = await run(startParams(options), { executionId: '2' });
				expect(mock.requests[0].headers['idempotency-key']).toBe('reminder-evt_123');
				expect(mock.placedCalls).toBe(1);
				expect(second.json.call_id).toBe(first.json.call_id);
			});

			it('refuses a key Ringee would not accept, before dialing', async () => {
				await expect(
					run(startParams({ options: { idempotencyKey: 'has spaces' } })),
				).rejects.toThrow(/Idempotency Key/);
				expect(mock.requests).toHaveLength(0);
			});

			it('reports a key reused for another number instead of dialing the wrong person', async () => {
				const options = { options: { idempotencyKey: 'reminder-evt_123' } };
				await run(startParams(options));
				const error = await run(startParams({ ...options, phoneNumber: '+14155550999' })).then(
					unexpectedSuccess,
					(e: unknown) => e as NodeApiError,
				);
				expect(error).toBeInstanceOf(NodeApiError);
				expect(error.message).toMatch(/already used for a different call/);
				expect(mock.placedCalls).toBe(1);
			});

			it('sends no key when the execution has no stable identity, rather than one that could hide a call', async () => {
				await run(startParams(), { executionId: undefined });
				expect(mock.requests[0].headers['idempotency-key']).toBeUndefined();
			});
		});

		describe('several items', () => {
			const items = [
				{ json: { phone: '+14155550101', name: 'Ada' } },
				{ json: { phone: '+14155550199', name: 'Blocked Bob' } },
				{ json: { phone: '+14155550103', name: 'Cleo' } },
			];
			const perItem = (key: string) => (i: number) => (items[i].json as IDataObject)[key];
			const batch = {
				resource: 'aiAgent',
				operation: 'startCall',
				agentId: agentRl,
				phoneNumber: perItem('phone'),
				variables: (i: number) => ({
					mappingMode: 'defineBelow',
					value: { first_name: items[i].json.name, notification: 'Demo' },
				}),
				options: {},
			};

			it('keeps each result linked to its own input item', async () => {
				const ok = [items[0], items[2]];
				const out = await run(
					{
						...batch,
						phoneNumber: (i: number) => ok[i].json.phone,
						variables: (i: number) => ({
							mappingMode: 'defineBelow',
							value: { first_name: ok[i].json.name, notification: 'x' },
						}),
					},
					{ items: ok },
				);
				expect(out.map((o) => o.pairedItem)).toEqual([{ item: 0 }, { item: 1 }]);
				expect(mock.placedCalls).toBe(2);
				expect(new Set(mock.requests.map((r) => r.headers['idempotency-key'])).size).toBe(2);
			});

			it('continues past a refused call when asked to, and says which item it was', async () => {
				const out = await run(batch, { items, continueOnFail: true });
				expect(out).toHaveLength(3);
				expect(out[0].json.status).toBe('initiating');
				expect(out[1].json.error).toMatch(/Do-Not-Call/);
				expect(out[1].pairedItem).toEqual({ item: 1 });
				expect(out[2].json.status).toBe('initiating');
				expect(out[2].pairedItem).toEqual({ item: 2 });
				expect(mock.placedCalls).toBe(2);
			});

			it('stops at the refused call otherwise, naming the item', async () => {
				const error = await run(batch, { items }).then(
					unexpectedSuccess,
					(e: unknown) => e as NodeApiError,
				);
				expect(error).toBeInstanceOf(NodeApiError);
				expect(error.message).toBe('That number is on your Do-Not-Call list');
				expect(error.context.itemIndex).toBe(1);
				// The call already placed stays placed; a retry of the node replays it.
				expect(mock.placedCalls).toBe(1);
			});

			it('does not dial the first person again when the whole node is retried', async () => {
				const sameAttempt = { items, executionId: '77' };
				await run(batch, sameAttempt).catch(() => undefined);
				await run(batch, { ...sameAttempt, continueOnFail: true });
				expect(mock.placedCalls).toBe(2); // Ada once (replayed), Cleo once — never twice
			});
		});

		it('does not dial twice when the answer to a call that was placed never arrives', async () => {
			const sameAttempt = { workflowId: 'wf-7', executionId: '991', nodeId: 'node-A' };
			mock.dropNextStartResponse = true;

			// First try: Ringee places the call, the connection dies before the answer.
			await expect(run(startParams(), sameAttempt)).rejects.toThrow(/Could not reach Ringee/);
			expect(mock.placedCalls).toBe(1);
			// n8n's Retry On Fail runs the node again, same attempt, same key.
			const [retried] = await run(startParams(), sameAttempt);

			expect(mock.placedCalls).toBe(1);
			expect(retried.json.idempotent_replayed).toBe(true);
		});

		it('maps input item fields to variables in auto-map mode', async () => {
			const out = await run(
				startParams({
					variables: {
						mappingMode: 'autoMapInputData',
						value: null,
						schema: [{ id: 'first_name' }, { id: 'notification' }],
					},
				}),
				{
					items: [{ json: { first_name: 'Ada', notification: 'Demo', secret: 'not a variable' } }],
				},
			);
			expect(out).toHaveLength(1);
			expect(mock.requests[0].body?.variables).toEqual({ first_name: 'Ada', notification: 'Demo' });
		});
	});

	it('reports a call in progress as not finished, and a completed one as finished', async () => {
		const [started] = await run({
			resource: 'aiAgent',
			operation: 'startCall',
			agentId: agentRl,
			phoneNumber: '+14155550123',
			variables: {},
			options: {},
		});
		const callId = started.json.call_id as string;

		const [pending] = await run({ resource: 'aiAgent', operation: 'getCallStatus', callId });
		expect(pending.json).toMatchObject({ call_id: callId, status: 'initiating', finished: false });

		mock.finishCall(callId);
		const [done] = await run({ resource: 'aiAgent', operation: 'getCallResult', callId });
		expect(done.json).toMatchObject({
			call_id: callId,
			status: 'completed',
			outcome: 'confirmed',
			finished: true,
		});
		expect(done.json.summary).toBe('Ada confirmed.');
	});

	it('tells which final statuses count as finished', async () => {
		for (const [status, finished] of [
			['ringing', false],
			['in_progress', false],
			['no_answer', true],
			['voicemail', true],
			['busy', true],
			['failed', true],
		] as const) {
			const [started] = await run({
				resource: 'aiAgent',
				operation: 'startCall',
				agentId: agentRl,
				phoneNumber: '+14155550123',
				variables: {},
				options: { idempotencyKey: `k-${status}` },
			});
			mock.finishCall(started.json.call_id as string, status);
			const [result] = await run({
				resource: 'aiAgent',
				operation: 'getCallStatus',
				callId: started.json.call_id,
			});
			expect(result.json.finished, status).toBe(finished);
		}
	});

	it('lists the calls of an agent', async () => {
		await run({
			resource: 'aiAgent',
			operation: 'startCall',
			agentId: agentRl,
			phoneNumber: '+14155550123',
			variables: {},
			options: {},
		});
		const out = await run({
			resource: 'aiAgent',
			operation: 'getManyCalls',
			agentId: agentRl,
			returnAll: true,
		});
		expect(out).toHaveLength(1);
		expect(out[0].json).toHaveProperty('finished', false);
	});

	it('refuses an empty Call ID with the field name', async () => {
		await expect(
			run({ resource: 'aiAgent', operation: 'getCallResult', callId: '  ' }),
		).rejects.toThrow(/Enter the ID of the call/);
	});
});

describe('Contact', () => {
	const base = { resource: 'contact' };

	it('creates, then refuses a duplicate with Ringee’s reason', async () => {
		const [created] = await run({
			...base,
			operation: 'create',
			phoneNumber: '+1 415 555 0123',
			additionalFields: { firstName: 'Ada', email: '', company: 'Analytical' },
		});
		expect(created.json).toMatchObject({ phoneNumber: '+14155550123', firstName: 'Ada' });
		expect(mock.requests[0].body).toEqual({
			phoneNumber: '+14155550123',
			firstName: 'Ada',
			company: 'Analytical',
		});

		const error = await run({
			...base,
			operation: 'create',
			phoneNumber: '+14155550123',
			additionalFields: {},
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toBe('Contact already exists');
	});

	it('creates or updates without failing on the second run', async () => {
		const params = {
			...base,
			operation: 'createOrUpdate',
			phoneNumber: '+14155550123',
			additionalFields: { jobTitle: 'Founder' },
		};
		const [first] = await run(params);
		const [second] = await run(params);
		expect(first.json.created).toBe(true);
		expect(second.json.created).toBe(false);
		expect(second.json.id).toBe(first.json.id);
		expect(mock.contacts).toHaveLength(1);
	});

	it('gets one contact by ID', async () => {
		const [created] = await run({
			...base,
			operation: 'create',
			phoneNumber: '+14155550123',
			additionalFields: {},
		});
		const [got] = await run({
			...base,
			operation: 'get',
			contactId: { mode: 'id', value: created.json.id },
		});
		expect(got.json.id).toBe(created.json.id);
		const error = await run({
			...base,
			operation: 'get',
			contactId: { mode: 'id', value: '9d1b7f0e-0000-4000-8000-000000000000' },
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toBe('Contact not found');
	});

	it('searches and pages through contacts', async () => {
		mock.contacts = Array.from({ length: 130 }, (_, i) => ({
			id: `c${i}`,
			phoneNumber: `+1415555${String(i).padStart(4, '0')}`,
			name: i % 2 ? 'Ada' : 'Grace',
		}));
		const everyone = await run({ ...base, operation: 'getMany', returnAll: true, filters: {} });
		expect(everyone).toHaveLength(130);
		const adas = await run({
			...base,
			operation: 'getMany',
			returnAll: true,
			filters: { query: 'ada' },
		});
		expect(adas).toHaveLength(65);
	});

	it('updates only what was given and refuses an empty update', async () => {
		const [created] = await run({
			...base,
			operation: 'create',
			phoneNumber: '+14155550123',
			additionalFields: { firstName: 'Ada' },
		});
		const contactId = { mode: 'id', value: created.json.id };
		const [updated] = await run({
			...base,
			operation: 'update',
			contactId,
			updateFields: { jobTitle: 'CTO', email: '' },
		});
		expect(updated.json).toMatchObject({ jobTitle: 'CTO', firstName: 'Ada' });
		expect(mock.requests.at(-1)!.body).toEqual({ jobTitle: 'CTO' });
		await expect(
			run({ ...base, operation: 'update', contactId, updateFields: { email: '' } }),
		).rejects.toThrow(/at least one field/);
	});

	it('deletes only after the contact’s own number is confirmed', async () => {
		const [created] = await run({
			...base,
			operation: 'create',
			phoneNumber: '+14155550123',
			additionalFields: {},
		});
		const contactId = { mode: 'id', value: created.json.id };

		await expect(
			run({ ...base, operation: 'delete', contactId, confirmPhoneNumber: '' }),
		).rejects.toThrow(/confirm/i);
		const wrong = await run({
			...base,
			operation: 'delete',
			contactId,
			confirmPhoneNumber: '+14155550000',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(wrong).toBeInstanceOf(NodeApiError);
		expect(mock.contacts).toHaveLength(1);

		const [deleted] = await run({
			...base,
			operation: 'delete',
			contactId,
			confirmPhoneNumber: '+14155550123',
		});
		expect(deleted.json).toEqual({ deleted: true, id: created.json.id });
		expect(mock.contacts).toHaveLength(0);
	});
});

describe('Call, Transcript and Recording', () => {
	const callId = '55555555-5555-4555-8555-555555555555';

	it('simplifies a call to what workflows use', async () => {
		const [item] = await run({ resource: 'call', operation: 'get', callId, simplify: true });
		expect(item.json).toMatchObject({
			callId,
			status: 'completed',
			outcome: 'meeting_booked',
			recordingAvailable: true,
			transcriptAvailable: true,
			aiSummary: 'Ada confirmed she will attend.',
			aiAgent: { name: 'Sofia Reminder Agent' },
		});
		expect(item.json).not.toHaveProperty('transcription');
	});

	it('returns the whole call when simplify is off', async () => {
		const [item] = await run({ resource: 'call', operation: 'get', callId, simplify: false });
		expect(item.json).toHaveProperty('transcription.segments');
	});

	it('accepts the ID Start Call returned as well as the call ID', async () => {
		const [started] = await run({
			resource: 'aiAgent',
			operation: 'startCall',
			agentId: agentRl,
			phoneNumber: '+14155550123',
			variables: {},
			options: {},
		});
		const [item] = await run({
			resource: 'call',
			operation: 'get',
			callId: started.json.call_id,
			simplify: true,
		});
		expect(item.json.callId).toBe(callId);
	});

	it('lists calls with the filters Ringee defines', async () => {
		await run({
			resource: 'call',
			operation: 'getMany',
			returnAll: false,
			limit: 10,
			filters: {
				outcome: 'meeting_booked',
				status: 'completed',
				dateFrom: '2026-11-01T00:00:00',
				contactId: '',
			},
		});
		expect(mock.requests[0].query).toMatchObject({
			outcome: 'meeting_booked',
			status: 'completed',
			limit: '10',
		});
		expect(mock.requests[0].query.date_from).toMatch(/^2026-11-01T/);
		expect(mock.requests[0].query).not.toHaveProperty('contact_id');
	});

	it('creates a dialer link and does not hand out the session token separately', async () => {
		const [item] = await run({
			resource: 'call',
			operation: 'createDialerLink',
			phoneNumber: '+14155550123',
			options: { agentEmail: 'agent@example.test' },
		});
		expect(item.json.dialerUrl).toMatch(/^https:\/\/www\.ringee\.io\/dashboard\/dialer/);
		expect(item.json).not.toHaveProperty('sessionToken');
		expect(mock.requests[0].path).toBe('/api/integrations/custom/click-to-call');
		expect(mock.requests[0].body).toEqual({
			phoneNumber: '+14155550123',
			agentEmail: 'agent@example.test',
		});
	});

	it('gets the transcript, with or without timed segments', async () => {
		const [plain] = await run({
			resource: 'transcript',
			operation: 'get',
			callId,
			includeSegments: false,
		});
		expect(plain.json).toMatchObject({ ready: true, language: 'en' });
		expect(plain.json).not.toHaveProperty('segments');
		const [timed] = await run({
			resource: 'transcript',
			operation: 'get',
			callId,
			includeSegments: true,
		});
		expect(timed.json.segments).toHaveLength(1);
	});

	it('says a transcript is not ready instead of failing', async () => {
		mock.callDetail = { ...mock.callDetail, transcription: undefined };
		const [item] = await run({
			resource: 'transcript',
			operation: 'get',
			callId,
			includeSegments: false,
		});
		expect(item.json).toMatchObject({ ready: false, text: null });
	});

	it('gets the AI analysis, summary and extracted information', async () => {
		const [analysis] = await run({ resource: 'transcript', operation: 'getAnalysis', callId });
		expect(analysis.json).toMatchObject({
			aiAgentCall: true,
			ready: true,
			outcome: 'confirmed',
			sentiment: 'positive',
		});
		const [summary] = await run({ resource: 'transcript', operation: 'getSummary', callId });
		expect(summary.json.summary).toBe('Ada confirmed she will attend.');
		const [data] = await run({
			resource: 'transcript',
			operation: 'getExtractedInformation',
			callId,
		});
		expect(data.json).toMatchObject({ ready: true, extractedData: { attending: true } });
	});

	it('answers for a human call that no AI agent made', async () => {
		mock.callDetail = { ...mock.callDetail, voiceAgentCall: undefined };
		const [analysis] = await run({ resource: 'transcript', operation: 'getAnalysis', callId });
		expect(analysis.json).toMatchObject({ aiAgentCall: false, ready: false, summary: null });
		const [data] = await run({
			resource: 'transcript',
			operation: 'getExtractedInformation',
			callId,
		});
		expect(data.json).toMatchObject({ aiAgentCall: false, ready: false, extractedData: {} });
	});

	it('describes a recording, and downloads it as binary data', async () => {
		const [info] = await run({ resource: 'recording', operation: 'get', callId });
		expect(info.json).toMatchObject({ available: true, format: 'mp3', durationSec: 110 });

		const [file] = await run({
			resource: 'recording',
			operation: 'download',
			callId,
			binaryPropertyName: 'audio',
		});
		expect(file.binary?.audio).toMatchObject({
			mimeType: 'audio/mpeg',
			fileName: `recording-${callId}.mp3`,
		});
		expect(Buffer.from(file.binary!.audio.data, 'base64').toString()).toBe('ID3-fake-mp3-bytes');
		expect(file.json).toMatchObject({ callId, sizeBytes: 18 });
		expect(file.pairedItem).toEqual({ item: 0 });
	});

	it('answers a missing recording with a clear message', async () => {
		const error = await run({
			resource: 'recording',
			operation: 'download',
			callId: '9d1b7f0e-0000-4000-8000-000000000000',
			binaryPropertyName: 'data',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toBe('Recording not found');
	});
});

describe('Phone Number', () => {
	it('lists the numbers an agent can call from, optionally by kind', async () => {
		expect(await run({ resource: 'phoneNumber', operation: 'getMany', filters: {} })).toHaveLength(
			2,
		);
		const verified = await run({
			resource: 'phoneNumber',
			operation: 'getMany',
			filters: { kind: 'verified_caller_id' },
		});
		expect(jsonOf(verified)).toEqual([expect.objectContaining({ phoneNumber: '+34910000102' })]);
	});

	it('gets one number, or says it is not there', async () => {
		const [one] = await run({
			resource: 'phoneNumber',
			operation: 'get',
			phoneNumberId: { mode: 'id', value: MOCK_NUMBER_ID },
		});
		expect(one.json.phoneNumber).toBe('+13055550101');
		await expect(
			run({
				resource: 'phoneNumber',
				operation: 'get',
				phoneNumberId: { mode: 'id', value: '9d1b7f0e-0000-4000-8000-000000000000' },
			}),
		).rejects.toThrow(/not found/);
	});
});

describe('dropdowns', () => {
	const load = () => makeContext({ baseUrl: mock.baseUrl, params: { agentId: agentRl } }).loadCtx;

	it('offers the agents that can place calls, not the receptionist', async () => {
		const { results } = await getAgents.call(load());
		expect(results.map((r) => r.name)).toEqual(['Sofia Reminder Agent']);
		expect(results[0].description).toBe('reminders notifications');
	});

	it('narrows agents and numbers by what was typed', async () => {
		expect((await getAgents.call(load(), 'zzz')).results).toEqual([]);
		expect((await getAgents.call(load(), 'sofia')).results).toHaveLength(1);
		expect((await getCallerNumbers.call(load(), '+34')).results.map((r) => r.name)).toEqual([
			'+34910000102',
		]);
	});

	it('pages through contacts as the list scrolls', async () => {
		mock.contacts = Array.from({ length: 120 }, (_, i) => ({
			id: `c${i}`,
			name: `Person ${i}`,
			phoneNumber: `+1415555${String(i).padStart(4, '0')}`,
		}));
		const first = await getContacts.call(load());
		expect(first.results).toHaveLength(50);
		expect(first.paginationToken).toBe('2');
		const last = await getContacts.call(load(), undefined, '3');
		expect(last.results).toHaveLength(20);
		expect(last.paginationToken).toBeUndefined();
	});

	it('builds the variable fields from the selected agent', async () => {
		const { fields } = await getAgentVariables.call(load());
		expect(fields).toEqual([
			expect.objectContaining({ id: 'first_name', displayName: 'First name', required: true }),
			expect.objectContaining({ id: 'notification', required: true }),
			expect.objectContaining({ id: 'appointment_date', required: false }),
		]);
	});

	it('offers no variables until an agent is chosen', async () => {
		const { loadCtx } = makeContext({
			baseUrl: mock.baseUrl,
			params: { agentId: { mode: 'list', value: '' } },
		});
		expect((await getAgentVariables.call(loadCtx)).fields).toEqual([]);
		expect(mock.requests).toHaveLength(0);
	});
});

describe('unsupported combinations', () => {
	it('names the operation that does not exist', async () => {
		await expect(run({ resource: 'contact', operation: 'merge' })).rejects.toThrow(
			/'merge' is not available for 'contact'/,
		);
	});
});

describe('Start Call asks the server what it can promise first', () => {
	const items = (count: number) => Array.from({ length: count }, () => ({ json: {} }));
	const start = (itemCount = 1) =>
		run(
			{
				resource: 'aiAgent',
				operation: 'startCall',
				agentId: agentRl,
				phoneNumber: (i: number) => `+1415555${String(100 + i)}`,
				variables: {
					mappingMode: 'defineBelow',
					value: { first_name: 'Ada', notification: 'Demo' },
				},
				options: {},
			},
			{ items: items(itemCount) },
		);
	const placedNothing = () => {
		expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
		expect(mock.placedCalls).toBe(0);
	};

	it('places no call at all against a Ringee that predates the capability route', async () => {
		// An older deployment ignores Idempotency-Key, so a retried call would be a second paid call.
		mock.capabilities = null;
		const error = await start().then(unexpectedSuccess, (e: unknown) => e as NodeOperationError);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error.message).toMatch(/too old/);
		expect(error.description).toMatch(/second paid call/);
		expect(error.description).toMatch(/Nothing was dialed/);
		placedNothing();
	});

	it('places no call when the server does not confirm idempotent calls', async () => {
		mock.capabilities = { apiVersion: 1, capabilities: { contacts: true, idempotentCalls: false } };
		await expect(start()).rejects.toThrow(/too old/);
		placedNothing();
	});

	it('reports a refused key as the ordinary error, before any call', async () => {
		mock.failNext.push({ method: 'GET', pathStartsWith: '/api/v1/capabilities', status: 401 });
		await expect(start()).rejects.toThrow(/did not accept the API key/);
		placedNothing();
	});

	it('asks once for a whole loop of items', async () => {
		const out = await start(5);
		expect(out).toHaveLength(5);
		expect(mock.placedCalls).toBe(5);
		expect(mock.capabilityRequests).toHaveLength(1);
	});

	it('asks again after a refusal, because the server may have been updated since', async () => {
		mock.capabilities = null;
		await expect(start()).rejects.toThrow(/too old/);
		mock.capabilities = {
			apiVersion: 1,
			capabilities: { agentDetail: true, contacts: true, calls: true, idempotentCalls: true },
		};
		await start();
		expect(mock.capabilityRequests).toHaveLength(2);
		expect(mock.placedCalls).toBe(1);
	});
});

describe('Start Call run by an AI agent', () => {
	const asTool = { nodeType: 'n8n-nodes-ringee.ringeeTool' };
	const startAs = (phone: string, options: Partial<ContextOptions>) =>
		run(
			{
				resource: 'aiAgent',
				operation: 'startCall',
				agentId: agentRl,
				phoneNumber: phone,
				variables: {
					mappingMode: 'defineBelow',
					value: { first_name: 'Ada', notification: 'Demo' },
				},
				options: {},
			},
			options,
		);

	it('dials a destination once even when the model asks for it again', async () => {
		// Each ask is a new run of the node, so a per-run key would dial twice.
		await startAs('+14155550123', { ...asTool, runIndex: 0 });
		const [again] = await startAs('+1 (415) 555-0123', { ...asTool, runIndex: 1 });
		expect(mock.placedCalls).toBe(1);
		expect(again.json.idempotent_replayed).toBe(true);
		const keys = mock.requests
			.filter((r) => r.method === 'POST')
			.map((r) => r.headers['idempotency-key']);
		expect(new Set(keys).size).toBe(1);
	});

	it('still dials a different destination as a different call', async () => {
		await startAs('+14155550123', { ...asTool, runIndex: 0 });
		await startAs('+14155550124', { ...asTool, runIndex: 1 });
		expect(mock.placedCalls).toBe(2);
	});

	it('keeps one key per run outside AI tools, where a new run is a new call', async () => {
		await startAs('+14155550123', { runIndex: 0 });
		await startAs('+14155550123', { runIndex: 1 });
		expect(mock.placedCalls).toBe(2);
	});
});
