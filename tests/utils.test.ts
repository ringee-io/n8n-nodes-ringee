import { describe, expect, it } from 'vitest';
import { parseBaseUrl } from '../lib/utils/base-url';
import { automaticIdempotencyKey, isValidIdempotencyKey } from '../lib/utils/idempotency';
import { cleanPhoneNumber } from '../lib/utils/phone';
import { SEEN_EVENT_MAX, SEEN_EVENT_TTL_MS, markEventSeen } from '../lib/utils/dedupe';
import { describeRingeeFailure } from '../lib/errors';

describe('Base URL', () => {
	it('defaults to Ringee Cloud', () => {
		expect(parseBaseUrl('')).toEqual({ ok: true, url: 'https://api.ringee.io' });
		expect(parseBaseUrl(undefined)).toEqual({ ok: true, url: 'https://api.ringee.io' });
	});

	it.each([
		['https://api.ringee.io', 'https://api.ringee.io'],
		['https://api.ringee.io/', 'https://api.ringee.io'],
		['https://api.ringee.io/api', 'https://api.ringee.io'],
		['https://api.ringee.io/api/', 'https://api.ringee.io'],
		['  https://ringee.example.com  ', 'https://ringee.example.com'],
		['https://ringee.example.com:8443/ringee', 'https://ringee.example.com:8443/ringee'],
		['http://localhost:3000', 'http://localhost:3000'],
		['http://127.0.0.1:3000/api', 'http://127.0.0.1:3000'],
	])('accepts %s', (input, expected) => {
		expect(parseBaseUrl(input)).toEqual({ ok: true, url: expected });
	});

	it.each([
		['not a url', /not a valid URL/],
		['http://api.ringee.io', /https/],
		['http://192.168.1.10', /https/],
		['ftp://api.ringee.io', /https/],
		['https://user:pass@api.ringee.io', /user name or password/],
		['https://api.ringee.io?x=1', /query string/],
		['https://api.ringee.io#top', /query string/],
	])('refuses %s so the key is never sent there', (input, message) => {
		const result = parseBaseUrl(input);
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.message).toMatch(message);
	});
});

describe('Idempotency keys', () => {
	it('names one attempt to place one call', () => {
		const base = { workflowId: 'wf1', executionId: '42', nodeId: 'n1', runIndex: 0, itemIndex: 0 };
		const key = automaticIdempotencyKey(base);
		expect(key).toBe('n8n:wf1:42:n1:r0:i0');
		// A retry of the same attempt repeats the key.
		expect(automaticIdempotencyKey({ ...base })).toBe(key);
	});

	it('gives different calls different keys', () => {
		const base = { workflowId: 'wf1', executionId: '42', nodeId: 'n1', runIndex: 0, itemIndex: 0 };
		const keys = new Set([
			automaticIdempotencyKey(base),
			automaticIdempotencyKey({ ...base, itemIndex: 1 }),
			automaticIdempotencyKey({ ...base, runIndex: 1 }),
			automaticIdempotencyKey({ ...base, executionId: '43' }),
			automaticIdempotencyKey({ ...base, nodeId: 'n2' }),
			automaticIdempotencyKey({ ...base, workflowId: 'wf2' }),
		]);
		expect(keys.size).toBe(6);
	});

	it('produces no key rather than an unstable one', () => {
		expect(
			automaticIdempotencyKey({ workflowId: 'wf1', nodeId: 'n1', itemIndex: 0 }),
		).toBeUndefined();
		expect(
			automaticIdempotencyKey({ executionId: '1', nodeId: 'n1', itemIndex: 0 }),
		).toBeUndefined();
	});

	it('only builds keys Ringee accepts', () => {
		expect(isValidIdempotencyKey('reminder-evt_123:a/b+c=d~e@f.g')).toBe(true);
		expect(isValidIdempotencyKey('')).toBe(false);
		expect(isValidIdempotencyKey('has space')).toBe(false);
		expect(isValidIdempotencyKey('x'.repeat(256))).toBe(false);
		expect(
			automaticIdempotencyKey({
				workflowId: 'w'.repeat(300),
				executionId: '1',
				nodeId: 'n',
				itemIndex: 0,
			}),
		).toBeUndefined();
	});
});

describe('Phone numbers', () => {
	it('keeps digits and a leading plus', () => {
		expect(cleanPhoneNumber('+1 (415) 555-0123')).toEqual({ value: '+14155550123' });
		expect(cleanPhoneNumber(' 415.555.0123 ')).toEqual({ value: '4155550123' });
	});

	it.each([
		[''],
		['   '],
		[undefined],
		[null],
		[42],
		['call me'],
		['+1415abc0123'],
		['123'],
		['1'.repeat(16)],
	])('rejects %j with a message that says what to do', (input) => {
		const result = cleanPhoneNumber(input);
		expect(result.value).toBeUndefined();
		expect(result.problem).toMatch(/\+14155550123/);
	});
});

describe('Duplicate events', () => {
	it('reports the second delivery of an event id', () => {
		const first = markEventSeen({}, 'evt_1', 1000);
		expect(first.duplicate).toBe(false);
		expect(markEventSeen(first.seen, 'evt_1', 2000).duplicate).toBe(true);
		expect(markEventSeen(first.seen, 'evt_2', 2000).duplicate).toBe(false);
	});

	it('forgets an event after a day', () => {
		const first = markEventSeen({}, 'evt_1', 0);
		expect(markEventSeen(first.seen, 'evt_1', SEEN_EVENT_TTL_MS + 1).duplicate).toBe(false);
	});

	it('keeps the newest events when the store is full', () => {
		let seen = {};
		for (let i = 0; i < SEEN_EVENT_MAX + 50; i++)
			seen = markEventSeen(seen, `evt_${i}`, 1000 + i).seen;
		expect(Object.keys(seen)).toHaveLength(SEEN_EVENT_MAX);
		expect(`evt_${SEEN_EVENT_MAX + 49}` in seen).toBe(true);
		expect('evt_0' in seen).toBe(false);
	});
});

describe('Error descriptions', () => {
	it('explains a rejected key', () => {
		const failure = describeRingeeFailure({ status: 401, body: { message: 'Invalid API key' } });
		expect(failure.message).toMatch(/did not accept the API key/);
		expect(failure.description).toMatch(/regenerated/);
		expect(failure.retryable).toBe(false);
	});

	it('explains missing credit, DNC and disabled calling', () => {
		expect(
			describeRingeeFailure({ status: 403, body: { message: 'Insufficient credits' } }).message,
		).toMatch(/no credits/);
		const dnc = describeRingeeFailure({
			status: 403,
			body: { message: 'Destination is on the DNC list: asked' },
		});
		expect(dnc.message).toMatch(/Do-Not-Call/);
		expect(dnc.description).toMatch(/did not place the call/);
		expect(
			describeRingeeFailure({ status: 403, body: { message: 'Outbound calling is disabled' } })
				.message,
		).toMatch(/turned off/);
	});

	it('explains a workspace without AI voice agents', () => {
		const failure = describeRingeeFailure({
			status: 403,
			body: { message: 'AI voice agents require an organization workspace' },
		});
		expect(failure.message).toMatch(/not enabled/);
	});

	it('recognizes a server too old for the route', () => {
		const failure = describeRingeeFailure({
			status: 404,
			body: { statusCode: 404, message: 'Cannot GET /api/v1/contacts', error: 'Not Found' },
		});
		expect(failure.message).toMatch(/does not offer that operation yet/);
		expect(failure.description).toMatch(/compatibility/);
	});

	it('names what was not found', () => {
		const failure = describeRingeeFailure({
			status: 404,
			body: { message: 'x' },
			subject: 'contact',
		});
		expect(failure.message).toBe('Contact not found');
	});

	it('turns validation messages and field maps into something actionable', () => {
		const failure = describeRingeeFailure({
			status: 400,
			body: {
				message: ['phoneNumber should not be empty'],
				fields: { phoneNumber: 'should not be empty' },
			},
		});
		expect(failure.message).toMatch(/phoneNumber should not be empty/);
		expect(failure.description).toMatch(/'phoneNumber': should not be empty/);
		expect(
			describeRingeeFailure({
				status: 400,
				body: { message: '"abc" is not a dialable phone number.' },
			}).message,
		).toMatch(/international format/);
	});

	it('marks rate limits and server answers as retryable, and says when', () => {
		const limited = describeRingeeFailure({ status: 429, body: {}, retryAfterSeconds: 30 });
		expect(limited.retryable).toBe(true);
		expect(limited.description).toMatch(/30 seconds/);
		expect(describeRingeeFailure({ status: 503, body: {} }).retryable).toBe(true);
		expect(describeRingeeFailure({ status: 400, body: {} }).retryable).toBe(false);
	});

	it('explains a redirect', () => {
		const failure = describeRingeeFailure({ status: 302, body: {} });
		expect(failure.message).toMatch(/redirect/);
		expect(failure.description).toMatch(/never follows redirects/);
	});

	it('avoids the words the n8n UX guidelines ask messages not to use', () => {
		const statuses = [300, 400, 401, 403, 404, 409, 422, 429, 500, 503];
		for (const status of statuses) {
			const { message, description } = describeRingeeFailure({ status, body: {} });
			expect(`${message} ${description}`).not.toMatch(/\b(error|problem|failure|mistake)s?\b/i);
		}
	});
});

describe('the key of a call an AI agent places', () => {
	const base = {
		workflowId: 'wf',
		executionId: '9',
		nodeId: 'n',
		itemIndex: 0,
		operation: 'abc123',
	};

	it('names the call, not the run of the node that made it', () => {
		expect(automaticIdempotencyKey({ ...base, runIndex: 0 })).toBe('n8n:wf:9:n:op-abc123');
		expect(automaticIdempotencyKey({ ...base, runIndex: 5 })).toBe('n8n:wf:9:n:op-abc123');
	});

	it("still separates executions, so tomorrow's call is a new call", () => {
		expect(automaticIdempotencyKey({ ...base, executionId: '10' })).not.toBe(
			automaticIdempotencyKey(base),
		);
	});
});
