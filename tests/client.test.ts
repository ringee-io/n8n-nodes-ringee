import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { ringeeRequest, ringeeRequestAllItems, shouldRetry } from '../lib/api/client';
import { MOCK_API_KEY, MockRingee } from './helpers/mock-ringee';
import { makeContext, unexpectedSuccess } from './helpers/context';

vi.mock('n8n-workflow', async (importOriginal) => {
	const actual = await importOriginal<typeof import('n8n-workflow')>();
	return { ...actual, sleep: vi.fn(async () => undefined) };
});

const mock = new MockRingee();
beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => {
	mock.reset();
	vi.mocked(sleep).mockClear();
});

const ctxFor = (
	overrides: Parameters<typeof makeContext>[0] extends infer T ? Partial<T> : never = {},
) => makeContext({ baseUrl: mock.baseUrl, ...overrides }).ctx;

describe('requests', () => {
	it('sends the API key and the right URL, and returns the body', async () => {
		const agents = await ringeeRequest<{ data: unknown[] }>(ctxFor(), {
			method: 'GET',
			path: '/v1/ai-voice-agents',
		});
		expect(agents.data).toHaveLength(2);
		expect(mock.requests[0].path).toBe('/api/v1/ai-voice-agents');
		expect(mock.requests[0].headers['x-ringee-api-key']).toBe(MOCK_API_KEY);
	});

	it('adds the Idempotency-Key header only when given one', async () => {
		await ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/ai-voice-agents' });
		await ringeeRequest(ctxFor(), {
			method: 'GET',
			path: '/v1/ai-voice-agents',
			idempotencyKey: 'k-1',
		});
		expect(mock.requests[0].headers['idempotency-key']).toBeUndefined();
		expect(mock.requests[1].headers['idempotency-key']).toBe('k-1');
	});

	it('accepts a Base URL pasted with /api or a trailing slash', async () => {
		for (const suffix of ['/', '/api', '/api/']) {
			mock.reset();
			await ringeeRequest(ctxFor({ baseUrl: `${mock.baseUrl}${suffix}` }), {
				method: 'GET',
				path: '/v1/ai-voice-agents',
			});
			expect(mock.requests[0].path).toBe('/api/v1/ai-voice-agents');
		}
	});
});

describe('credential safety', () => {
	it('refuses a Base URL that is not https before sending anything', async () => {
		const attempt = ringeeRequest(ctxFor({ baseUrl: 'http://api.ringee.io' }), {
			method: 'GET',
			path: '/v1/contacts',
		});
		await expect(attempt).rejects.toBeInstanceOf(NodeOperationError);
		await expect(attempt).rejects.toThrow(/https/);
		expect(mock.requests).toHaveLength(0);
	});

	it('never follows a redirect, so the key cannot be handed to another host', async () => {
		mock.redirectTo = 'https://evil.example.test/collect';
		const attempt = ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/contacts' });
		await expect(attempt).rejects.toBeInstanceOf(NodeApiError);
		await expect(attempt).rejects.toThrow(/redirect/);
		expect(mock.requests).toHaveLength(1);
	});

	it('keeps the API key out of every error it raises', async () => {
		const attempt = ringeeRequest(ctxFor({ apiKey: 'cik_live_' + 'f'.repeat(64) }), {
			method: 'GET',
			path: '/v1/contacts',
		});
		const error = await attempt.then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.httpCode).toBe('401');
		const text = JSON.stringify(error, Object.getOwnPropertyNames(error));
		expect(text).not.toContain('f'.repeat(64));
		expect(text).not.toContain(MOCK_API_KEY);
	});
});

describe('failures', () => {
	it('turns Ringee refusals into messages that say what to do', async () => {
		const error = await ringeeRequest(ctxFor({ apiKey: 'cik_live_wrong' }), {
			method: 'GET',
			path: '/v1/contacts',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toBe('Ringee did not accept the API key');
		expect(error.description).toMatch(/Custom Integration/);
	});

	it('names what was not found', async () => {
		const error = await ringeeRequest(ctxFor(), {
			method: 'GET',
			path: '/v1/contacts/9d1b7f0e-0000-4000-8000-000000000000',
			subject: 'contact',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toBe('Contact not found');
	});

	it('explains a key whose first attempt failed before any call was placed', async () => {
		mock.failNext.push({
			method: 'POST',
			pathStartsWith: '/api/v1/ai-voice-agents',
			status: 409,
			body: {
				statusCode: 409,
				code: 'idempotency_key_failed',
				message:
					'The first attempt under this Idempotency-Key failed before the call was placed. Nothing was dialed. Send a new Idempotency-Key to try again.',
			},
		});
		const error = await ringeeRequest(ctxFor(), {
			method: 'POST',
			path: '/v1/ai-voice-agents/x/calls',
			body: { to: '+14155550123' },
			idempotencyKey: 'k-1',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error.message).toMatch(/Nothing was dialed/);
		expect(error.description).toMatch(/Retry On Fail sends the same key/);
		expect(error.description).toMatch(/new execution/);
		// And it is never repeated by the client itself.
		expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
	});

	it('says plainly when the server is too old for a route', async () => {
		const error = await ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/not-a-route' }).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error.message).toMatch(/does not offer that operation yet/);
	});

	it('reports an unreachable server', async () => {
		const error = await ringeeRequest(ctxFor({ baseUrl: 'http://127.0.0.1:1' }), {
			method: 'GET',
			path: '/v1/contacts',
		}).then(unexpectedSuccess, (e: unknown) => e as NodeApiError);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Could not reach Ringee');
	});
});

describe('retries only where repeating is safe', () => {
	it.each([
		['GET', undefined, true],
		['POST', undefined, false],
		['PUT', undefined, false],
		['PATCH', undefined, false],
		['DELETE', undefined, false],
		['GET', 429, true],
		['POST', 429, true],
		['DELETE', 429, true],
		['GET', 503, true],
		['POST', 503, false],
		['POST', 502, false],
		['GET', 500, false],
		['GET', 404, false],
		['POST', 400, false],
		['POST', 403, false],
	])('%s after %s → retry %s', (method, status, expected) => {
		expect(shouldRetry(method, status)).toBe(expected);
	});

	it('repeats a read that met a gateway failure', async () => {
		mock.failNext = [
			{ method: 'GET', pathStartsWith: '/api/v1/contacts', status: 503 },
			{ method: 'GET', pathStartsWith: '/api/v1/contacts', status: 503 },
		];
		await ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/contacts' });
		expect(mock.requests).toHaveLength(3);
		expect(vi.mocked(sleep)).toHaveBeenCalledTimes(2);
	});

	it('gives up after two repeats', async () => {
		mock.failNext = Array.from({ length: 5 }, () => ({
			method: 'GET',
			pathStartsWith: '/api/v1/contacts',
			status: 503,
		}));
		await expect(ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/contacts' })).rejects.toThrow(
			/could not complete/,
		);
		expect(mock.requests).toHaveLength(3);
	});

	it('never repeats a write that may have been processed', async () => {
		mock.failNext = [{ method: 'POST', pathStartsWith: '/api/v1/contacts', status: 503 }];
		await expect(
			ringeeRequest(ctxFor(), {
				method: 'POST',
				path: '/v1/contacts',
				body: { phoneNumber: '+14155550123' },
			}),
		).rejects.toBeInstanceOf(NodeApiError);
		expect(mock.requests).toHaveLength(1);
		expect(mock.contacts).toHaveLength(0);
	});

	it('repeats a rate-limited write after the wait Ringee asked for', async () => {
		mock.failNext = [
			{
				method: 'POST',
				pathStartsWith: '/api/v1/contacts',
				status: 429,
				headers: { 'retry-after': '7' },
			},
		];
		const created = await ringeeRequest<{ phoneNumber: string }>(ctxFor(), {
			method: 'POST',
			path: '/v1/contacts',
			body: { phoneNumber: '+14155550123' },
		});
		expect(created.phoneNumber).toBe('+14155550123');
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(7000);
		expect(mock.contacts).toHaveLength(1);
	});

	it('caps how long it will wait', async () => {
		mock.failNext = [
			{
				method: 'GET',
				pathStartsWith: '/api/v1/contacts',
				status: 429,
				headers: { 'retry-after': '3600' },
			},
		];
		await ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/contacts' });
		expect(vi.mocked(sleep)).toHaveBeenCalledWith(20_000);
	});

	it('tells the user when it is still rate limited', async () => {
		mock.failNext = Array.from({ length: 3 }, () => ({
			method: 'GET',
			pathStartsWith: '/api/v1/contacts',
			status: 429,
			headers: { 'retry-after': '1' },
		}));
		const error = await ringeeRequest(ctxFor(), { method: 'GET', path: '/v1/contacts' }).then(
			unexpectedSuccess,
			(e: unknown) => e as NodeApiError,
		);
		expect(error.message).toMatch(/limiting how fast/);
		expect(error.description).toMatch(/1 seconds/);
	});
});

describe('pagination', () => {
	const seed = (count: number) => {
		mock.contacts = Array.from({ length: count }, (_, i) => ({
			id: `c${i}`,
			phoneNumber: `+1415555${String(i).padStart(4, '0')}`,
		}));
	};

	it('returns everything across pages when asked for all', async () => {
		seed(250);
		const all = await ringeeRequestAllItems<{ id: string }>(
			ctxFor(),
			{ method: 'GET', path: '/v1/contacts' },
			{ returnAll: true },
		);
		expect(all).toHaveLength(250);
		expect(new Set(all.map((c) => c.id)).size).toBe(250);
		expect(mock.requests.map((r) => r.query.page)).toEqual(['1', '2', '3']);
	});

	it('stops at the limit and returns each of the first rows exactly once', async () => {
		// F-05: a limit that is not a multiple of the page size used to shrink the
		// last page's `limit`, and Ringee pages by `skip = (page - 1) * limit`, so
		// the second page re-read rows 21-40 instead of 101-120. Only the length
		// was asserted, which is why 120 rows "passed".
		seed(250);
		const some = await ringeeRequestAllItems<{ id: string }>(
			ctxFor(),
			{ method: 'GET', path: '/v1/contacts' },
			{ returnAll: false, limit: 120 },
		);
		expect(some.map((c) => c.id)).toEqual(Array.from({ length: 120 }, (_, i) => `c${i}`));
		// One page size for every request, so the pages tile the list.
		expect(new Set(mock.requests.map((r) => r.query.limit)).size).toBe(1);
	});

	it('never skips or repeats a row for any limit', async () => {
		seed(450);
		for (const limit of [1, 7, 99, 100, 101, 150, 199, 200, 201, 333, 450, 600]) {
			mock.requests.length = 0;
			const rows = await ringeeRequestAllItems<{ id: string }>(
				ctxFor(),
				{ method: 'GET', path: '/v1/contacts' },
				{ returnAll: false, limit },
			);
			const expected = Math.min(limit, 450);
			expect(
				rows.map((c) => c.id),
				`limit ${limit}`,
			).toEqual(Array.from({ length: expected }, (_, i) => `c${i}`));
		}
	});

	it('asks for a small page when only a few rows are wanted', async () => {
		seed(250);
		await ringeeRequestAllItems(
			ctxFor(),
			{ method: 'GET', path: '/v1/contacts' },
			{ returnAll: false, limit: 5 },
		);
		expect(mock.requests.map((r) => r.query.limit)).toEqual(['5']);
	});

	it('handles an empty list and an exact page boundary', async () => {
		expect(
			await ringeeRequestAllItems(
				ctxFor(),
				{ method: 'GET', path: '/v1/contacts' },
				{ returnAll: true },
			),
		).toEqual([]);
		seed(100);
		mock.requests.length = 0;
		const all = await ringeeRequestAllItems(
			ctxFor(),
			{ method: 'GET', path: '/v1/contacts' },
			{ returnAll: true },
		);
		expect(all).toHaveLength(100);
		expect(mock.requests).toHaveLength(1);
	});

	it('keeps its own filters on every page', async () => {
		seed(150);
		await ringeeRequestAllItems(
			ctxFor(),
			{ method: 'GET', path: '/v1/contacts', qs: { query: '4155' } },
			{ returnAll: true },
		);
		expect(mock.requests.every((r) => r.query.query === '4155')).toBe(true);
	});
});
