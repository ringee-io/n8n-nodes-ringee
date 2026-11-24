/* eslint-disable @n8n/community-nodes/no-restricted-imports -- test-only HTTP server; tests are never published */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export const MOCK_API_KEY = 'cik_live_' + 'a'.repeat(64);
export const MOCK_AGENT_ID = '11111111-1111-4111-8111-111111111111';
export const MOCK_NUMBER_ID = '22222222-2222-4222-8222-222222222222';

type Json = Record<string, unknown>;

export interface RecordedRequest {
	method: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string | string[] | undefined>;
	body: Json | undefined;
}

/**
 * An in-memory Ringee API for tests: the public routes the node uses, with the
 * behaviours that matter to it (API key check, idempotent replay, paging,
 * validation, rate limiting, a recording download). It answers over real HTTP,
 * so the node's request code runs exactly as it would against Ringee.
 */
export class MockRingee {
	readonly requests: RecordedRequest[] = [];
	/** Called for every request, for tools that want to watch traffic. */
	onRequest?: (request: RecordedRequest) => void;
	private server!: Server;
	baseUrl = '';

	/** Make the next N matching requests answer this status instead. */
	failNext: Array<{
		method: string;
		pathStartsWith: string;
		status: number;
		headers?: Record<string, string>;
		body?: unknown;
	}> = [];

	agents = [
		{
			id: MOCK_AGENT_ID,
			name: 'Sofia Reminder Agent',
			type: 'reminders_notifications',
			status: 'active',
			voice: 'Aria',
			callCount: 4,
			callerNumberId: MOCK_NUMBER_ID,
			callsFrom: '+13055550101',
			createdAt: '2026-11-01T10:00:00.000Z',
			updatedAt: '2026-11-02T10:00:00.000Z',
		},
		{
			id: '33333333-3333-4333-8333-333333333333',
			name: 'Front Desk',
			type: 'receptionist',
			status: 'active',
			voice: 'Nova',
			callCount: 0,
			callerNumberId: null,
			callsFrom: null,
			createdAt: '2026-11-01T10:00:00.000Z',
			updatedAt: '2026-11-02T10:00:00.000Z',
		},
	];
	variables = [
		{ key: 'first_name', label: 'First name', required: true },
		{ key: 'notification', label: 'Notification', required: true },
		{ key: 'appointment_date', label: 'Date', required: false },
	];
	callerNumbers = [
		{ id: MOCK_NUMBER_ID, phoneNumber: '+13055550101', isoCountry: 'US', kind: 'purchased' },
		{
			id: '44444444-4444-4444-8444-444444444444',
			phoneNumber: '+34910000102',
			isoCountry: 'ES',
			kind: 'verified_caller_id',
		},
	];
	contacts: Json[] = [];
	/** agent calls by id, and the idempotency keys that created them */
	agentCalls = new Map<string, Json>();
	private keys = new Map<string, string>();
	placedCalls = 0;
	/** The telephony call detail, returned for any known call id. */
	callDetail: Json = {
		callId: '55555555-5555-4555-8555-555555555555',
		fromNumber: '+13055550101',
		toNumber: '+14155550123',
		status: 'completed',
		direction: 'outbound',
		source: 'ai_voice_agent',
		startedAt: '2026-11-20T10:00:00.000Z',
		answeredAt: '2026-11-20T10:00:06.000Z',
		endedAt: '2026-11-20T10:02:00.000Z',
		durationSeconds: 114,
		outcome: 'meeting_booked',
		outcomeNote: 'Confirmed for Tuesday',
		contact: { id: 'c1', phoneNumber: '+14155550123', fullName: 'Ada Lovelace' },
		recording: {
			recordingId: 'r1',
			url: 'https://recordings.example.test/r1.mp3',
			status: 'completed',
			format: 'mp3',
			durationSec: 110,
		},
		transcription: {
			status: 'completed',
			language: 'en',
			text: 'Hi Ada, this is Sofia from Ringee. Can you attend tomorrow? Yes, I will be there.',
			segments: [
				{ text: 'Hi Ada, this is Sofia from Ringee.', speaker: 0, startMs: 0, endMs: 2400 },
			],
		},
		voiceAgentCall: {
			id: 'agent-call-1',
			agent: { id: MOCK_AGENT_ID, name: 'Sofia Reminder Agent' },
			status: 'completed',
			outcome: 'confirmed',
			summary: 'Ada confirmed she will attend.',
			sentiment: 'positive',
			extractedData: { attending: true },
		},
	};
	knownCallIds = new Set(['55555555-5555-4555-8555-555555555555']);
	/** Every `GET /v1/capabilities` the node made. */
	capabilityRequests: RecordedRequest[] = [];
	/** What `GET /v1/capabilities` answers; `null` is a Ringee that predates the route. */
	capabilities: Json | null = {
		apiVersion: 1,
		capabilities: { agentDetail: true, contacts: true, calls: true, idempotentCalls: true },
	};
	redirectTo: string | null = null;
	/** Place the next call, then drop the connection before answering: a lost response. */
	dropNextStartResponse = false;

	private defaults?: {
		agents: unknown;
		variables: unknown;
		callDetail: unknown;
		callerNumbers: unknown;
	};

	async start(port = 0): Promise<void> {
		this.defaults = structuredClone({
			agents: this.agents,
			variables: this.variables,
			callDetail: this.callDetail,
			callerNumbers: this.callerNumbers,
		});
		this.server = createServer((req, res) => void this.handle(req, res));
		await new Promise<void>((resolve) => this.server.listen(port, '127.0.0.1', resolve));
		this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	reset(): void {
		if (this.defaults) {
			const fresh = structuredClone(this.defaults) as {
				agents: MockRingee['agents'];
				variables: MockRingee['variables'];
				callDetail: Json;
				callerNumbers: MockRingee['callerNumbers'];
			};
			this.agents = fresh.agents;
			this.variables = fresh.variables;
			this.callDetail = fresh.callDetail;
			this.callerNumbers = fresh.callerNumbers;
		}
		this.capabilities = {
			apiVersion: 1,
			capabilities: { agentDetail: true, contacts: true, calls: true, idempotentCalls: true },
		};
		this.requests.length = 0;
		this.capabilityRequests.length = 0;
		this.failNext = [];
		this.agentCalls.clear();
		this.keys.clear();
		this.placedCalls = 0;
		this.contacts = [];
		this.redirectTo = null;
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', this.baseUrl);
		const raw = await readBody(req);
		let body: Json | undefined;
		try {
			body = raw ? (JSON.parse(raw) as Json) : undefined;
		} catch {
			body = undefined;
		}
		const method = req.method ?? 'GET';
		const recorded: RecordedRequest = {
			method,
			path: url.pathname,
			query: Object.fromEntries(url.searchParams.entries()),
			headers: req.headers,
			body,
		};
		// Capability probes are the node's own bookkeeping, not part of the
		// workflow's traffic, so they are kept apart from `requests`.
		if (url.pathname === '/api/v1/capabilities') this.capabilityRequests.push(recorded);
		else this.requests.push(recorded);
		this.onRequest?.(recorded);

		const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
			const isBuffer = Buffer.isBuffer(payload);
			res.writeHead(status, {
				'content-type': isBuffer ? 'audio/mpeg' : 'application/json',
				...headers,
			});
			res.end(isBuffer ? payload : JSON.stringify(payload));
		};

		if (this.redirectTo) return send(302, {}, { location: this.redirectTo });

		const forced = this.failNext.findIndex(
			(f) => f.method === method && url.pathname.startsWith(f.pathStartsWith),
		);
		if (forced >= 0) {
			const [fail] = this.failNext.splice(forced, 1);
			return send(
				fail.status,
				fail.body ?? { statusCode: fail.status, message: 'forced' },
				fail.headers,
			);
		}

		const key = req.headers['x-ringee-api-key'];
		if (key !== MOCK_API_KEY) {
			return send(401, { statusCode: 401, message: 'Invalid API key' });
		}

		const path = url.pathname;
		const segments = path.split('/').filter(Boolean); // api, v1, ...
		if (segments[0] !== 'api')
			return send(404, { statusCode: 404, message: `Cannot ${method} ${path}` });

		// ── Capabilities ───────────────────────────────────────────────────
		if (segments[1] === 'v1' && segments[2] === 'capabilities' && method === 'GET') {
			return this.capabilities
				? send(200, this.capabilities)
				: send(404, { statusCode: 404, message: `Cannot GET ${path}`, error: 'Not Found' });
		}

		// ── AI voice agents ────────────────────────────────────────────────
		if (segments[1] === 'v1' && segments[2] === 'ai-voice-agents') {
			if (segments.length === 3 && method === 'GET') {
				return send(200, this.page(this.agents, url, { callerNumbers: this.callerNumbers }));
			}
			if (segments[3] === 'phone-numbers' && method === 'GET') return send(200, this.callerNumbers);
			if (segments[3] === 'calls' && segments[4] && method === 'GET') {
				const call = this.agentCalls.get(segments[4]);
				if (!call) return send(404, { statusCode: 404, message: 'AI voice agent call not found' });
				return send(200, this.resultOf(call));
			}
			const agent = this.agents.find((a) => a.id === segments[3]);
			if (segments.length === 4 && method === 'GET') {
				if (!agent) return send(404, { statusCode: 404, message: 'AI voice agent not found' });
				return send(200, { ...agent, variables: this.variables });
			}
			if (segments[4] === 'calls' && method === 'GET' && agent) {
				return send(
					200,
					this.page(
						[...this.agentCalls.values()].map((c) => this.resultOf(c)),
						url,
					),
				);
			}
			if (segments[4] === 'calls' && method === 'POST') {
				if (!agent) return send(404, { statusCode: 404, message: 'AI voice agent not found' });
				if (!body?.to || typeof body.to !== 'string' || !/^\+?\d{6,15}$/.test(body.to)) {
					return send(400, {
						statusCode: 400,
						message: `"${String(body?.to)}" is not a dialable phone number.`,
					});
				}
				if (body.to === '+14155550199') {
					return send(403, { statusCode: 403, message: 'Destination is on the DNC list' });
				}
				const idem = req.headers['idempotency-key'] as string | undefined;
				if (idem) {
					const earlierId = this.keys.get(idem);
					if (earlierId) {
						const earlier = this.agentCalls.get(earlierId)!;
						if (earlier.to !== body.to) {
							return send(422, {
								statusCode: 422,
								message:
									'This idempotency key was already used for a different call. Send a new key to place a new call.',
							});
						}
						return send(
							200,
							{ id: earlierId, status: earlier.status, idempotent_replayed: true },
							{ 'idempotent-replayed': 'true' },
						);
					}
				}
				const id = randomUUID();
				this.agentCalls.set(id, {
					id,
					to: body.to,
					agentId: agent.id,
					status: 'initiating',
					metadata: body.metadata ?? {},
					variables: body.variables ?? {},
				});
				if (idem) this.keys.set(idem, id);
				this.placedCalls += 1;
				if (this.dropNextStartResponse) {
					this.dropNextStartResponse = false;
					req.socket.destroy();
					return;
				}
				return send(
					201,
					idem
						? { id, status: 'initiating', idempotent_replayed: false }
						: { id, status: 'initiating' },
				);
			}
		}

		// ── Contacts ───────────────────────────────────────────────────────
		if (segments[1] === 'v1' && segments[2] === 'contacts') {
			const id = segments[3];
			if (!id && method === 'GET') {
				const q = (url.searchParams.get('query') ?? '').toLowerCase();
				const rows = this.contacts.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
				return send(200, this.page(rows, url));
			}
			if (!id && method === 'POST') {
				if (this.contacts.some((c) => c.phoneNumber === body?.phoneNumber)) {
					return send(400, { statusCode: 400, message: 'Contact already exists' });
				}
				const created = this.newContact(body ?? {});
				return send(201, created);
			}
			if (!id && method === 'PUT') {
				const existing = this.contacts.find((c) => c.phoneNumber === body?.phoneNumber);
				if (existing) {
					Object.assign(existing, body, { updatedAt: new Date().toISOString() });
					return send(200, { ...existing, created: false });
				}
				return send(201, { ...this.newContact(body ?? {}), created: true });
			}
			const contact = this.contacts.find((c) => c.id === id);
			if (id && method === 'GET')
				return contact
					? send(200, contact)
					: send(404, { statusCode: 404, message: 'Contact not found' });
			if (id && method === 'PATCH') {
				if (!contact) return send(404, { statusCode: 404, message: 'Contact not found' });
				Object.assign(contact, body, { updatedAt: new Date().toISOString() });
				return send(200, contact);
			}
			if (id && method === 'DELETE') {
				if (!contact) return send(404, { statusCode: 404, message: 'Contact not found' });
				if (url.searchParams.get('confirm_phone_number') !== contact.phoneNumber) {
					return send(400, {
						statusCode: 400,
						message: "confirm_phone_number must be the contact's phone number.",
					});
				}
				this.contacts = this.contacts.filter((c) => c.id !== id);
				return send(200, { deleted: true, id });
			}
		}

		// ── Calls ──────────────────────────────────────────────────────────
		if (segments[1] === 'v1' && segments[2] === 'calls') {
			const id = segments[3];
			if (!id && method === 'GET') {
				return send(
					200,
					this.page(
						[
							{
								id: this.callDetail.callId,
								status: 'completed',
								direction: 'outbound',
								outcome: 'meeting_booked',
								fromNumber: '+13055550101',
								toNumber: '+14155550123',
							},
						],
						url,
					),
				);
			}
			const known = id && (this.knownCallIds.has(id) || [...this.agentCalls.keys()].includes(id));
			if (id && !segments[4] && method === 'GET') {
				return known
					? send(200, this.callDetail)
					: send(404, { statusCode: 404, message: 'Call not found' });
			}
			if (id && segments[4] === 'recording' && method === 'GET') {
				return known
					? send(200, Buffer.from('ID3-fake-mp3-bytes'))
					: send(404, { statusCode: 404, message: 'Recording not found' });
			}
		}

		// ── Click to call ──────────────────────────────────────────────────
		if (path === '/api/integrations/custom/click-to-call' && method === 'POST') {
			return send(201, {
				contactId: null,
				agentUserId: 'user-1',
				toNumber: body?.phoneNumber,
				fromNumber: '+13055550101',
				dialerUrl: 'https://www.ringee.io/dashboard/dialer?session=SECRET&to=%2B14155550123',
				sessionToken: 'SECRET',
				expiresAt: '2026-11-24T12:05:00.000Z',
			});
		}

		return send(404, { statusCode: 404, message: `Cannot ${method} ${path}`, error: 'Not Found' });
	}

	private newContact(input: Json): Json {
		const created = {
			id: randomUUID(),
			name: null,
			firstName: null,
			lastName: null,
			email: null,
			company: null,
			jobTitle: null,
			state: null,
			website: null,
			revenue: null,
			companySize: null,
			source: 'api',
			lastCallAt: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			...input,
		};
		this.contacts.push(created);
		return created;
	}

	private resultOf(call: Json): Json {
		return {
			call_id: call.id,
			status: call.status,
			outcome: call.status === 'completed' ? 'confirmed' : null,
			summary: call.status === 'completed' ? 'Ada confirmed.' : null,
			sentiment: null,
			extracted_data: {},
			metadata: call.metadata ?? {},
		};
	}

	/** Paged list in Ringee's `{ data, total, page, limit, totalPages }` shape. */
	private page(rows: unknown[], url: URL, extra: Json = {}): Json {
		const page = Number(url.searchParams.get('page') ?? 1);
		const limit = Number(url.searchParams.get('limit') ?? 20);
		const data = rows.slice((page - 1) * limit, page * limit);
		return {
			data,
			total: rows.length,
			page,
			limit,
			totalPages: Math.max(1, Math.ceil(rows.length / limit)),
			...extra,
		};
	}

	/** Mark an agent call as finished, as the post-call analysis would. */
	finishCall(id: string, status = 'completed'): void {
		const call = this.agentCalls.get(id);
		if (call) call.status = status;
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => chunks.push(chunk));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
	});
}
