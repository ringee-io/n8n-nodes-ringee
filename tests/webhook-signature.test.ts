import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TOLERANCE_SECONDS,
	parseSignatureHeader,
	signRingeeBody,
	verifyRingeeSignature,
} from '../lib/utils/webhook';

const SECRET = 'whsec_' + 'b'.repeat(64);
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const BODY = JSON.stringify({ event: 'call.completed', eventId: 'evt_1', data: { callId: 'c1' } });

describe('Ringee webhook signatures', () => {
	it('accepts a delivery signed the way Ringee signs it', () => {
		// Ringee: HMAC_SHA256(secret, "<timestamp>.<body>"), header t=<ts>,v1=<hex>
		const timestamp = Math.floor(NOW / 1000);
		const v1 = createHmac('sha256', SECRET).update(`${timestamp}.${BODY}`).digest('hex');
		const result = verifyRingeeSignature({
			rawBody: Buffer.from(BODY),
			secret: SECRET,
			signatureHeader: `t=${timestamp},v1=${v1}`,
			nowMs: NOW,
		});
		expect(result).toEqual({ ok: true, timestamp });
	});

	it('accepts what signRingeeBody produces', () => {
		expect(
			verifyRingeeSignature({
				rawBody: BODY,
				secret: SECRET,
				signatureHeader: signRingeeBody(BODY, SECRET, NOW),
				nowMs: NOW,
			}).ok,
		).toBe(true);
	});

	it('rejects a body that changed by one byte', () => {
		const header = signRingeeBody(BODY, SECRET, NOW);
		for (const tampered of [
			BODY.replace('evt_1', 'evt_2'),
			`${BODY} `,
			BODY.replace('call', 'Call'),
		]) {
			expect(
				verifyRingeeSignature({
					rawBody: tampered,
					secret: SECRET,
					signatureHeader: header,
					nowMs: NOW,
				}),
			).toMatchObject({ ok: false, reason: 'bad_signature' });
		}
	});

	it('rejects the wrong secret', () => {
		expect(
			verifyRingeeSignature({
				rawBody: BODY,
				secret: 'whsec_other',
				signatureHeader: signRingeeBody(BODY, SECRET, NOW),
				nowMs: NOW,
			}),
		).toMatchObject({ ok: false, reason: 'bad_signature' });
	});

	it('fails closed without a secret', () => {
		for (const secret of [undefined, '', '   ']) {
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret,
					signatureHeader: signRingeeBody(BODY, SECRET, NOW),
					nowMs: NOW,
				}),
			).toEqual({ ok: false, reason: 'missing_secret' });
		}
	});

	it('fails closed without a signature', () => {
		expect(
			verifyRingeeSignature({
				rawBody: BODY,
				secret: SECRET,
				signatureHeader: undefined,
				nowMs: NOW,
			}),
		).toEqual({ ok: false, reason: 'missing_signature' });
	});

	it.each([
		[''],
		['garbage'],
		['t=abc,v1=ff'],
		[`t=${Math.floor(NOW / 1000)}`],
		['v1=' + 'a'.repeat(64)],
		[`t=1,v1=zz${'a'.repeat(62)}`],
	])('rejects the malformed header %j', (header) => {
		expect(
			verifyRingeeSignature({ rawBody: BODY, secret: SECRET, signatureHeader: header, nowMs: NOW }),
		).toMatchObject({ ok: false, reason: header ? 'malformed_signature' : 'missing_signature' });
	});

	describe('replay protection', () => {
		it('rejects a correctly signed delivery that is too old', () => {
			const signedAt = NOW - (DEFAULT_TOLERANCE_SECONDS + 1) * 1000;
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: signRingeeBody(BODY, SECRET, signedAt),
					nowMs: NOW,
				}),
			).toMatchObject({ ok: false, reason: 'timestamp_out_of_range' });
		});

		it('rejects one dated in the future', () => {
			const signedAt = NOW + (DEFAULT_TOLERANCE_SECONDS + 5) * 1000;
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: signRingeeBody(BODY, SECRET, signedAt),
					nowMs: NOW,
				}),
			).toMatchObject({ ok: false, reason: 'timestamp_out_of_range' });
		});

		it('accepts right at the edge of the window, and honors a custom window', () => {
			const atEdge = NOW - DEFAULT_TOLERANCE_SECONDS * 1000;
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: signRingeeBody(BODY, SECRET, atEdge),
					nowMs: NOW,
				}).ok,
			).toBe(true);
			const tenMinutes = NOW - 600 * 1000;
			const header = signRingeeBody(BODY, SECRET, tenMinutes);
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: header,
					nowMs: NOW,
				}).ok,
			).toBe(false);
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: header,
					nowMs: NOW,
					toleranceSeconds: 900,
				}).ok,
			).toBe(true);
		});

		it('cannot be replayed with a fresher timestamp, because the timestamp is signed', () => {
			const old = signRingeeBody(BODY, SECRET, NOW - 3600 * 1000);
			const v1 = /v1=([0-9a-f]+)/.exec(old)![1];
			const forged = `t=${Math.floor(NOW / 1000)},v1=${v1}`;
			expect(
				verifyRingeeSignature({
					rawBody: BODY,
					secret: SECRET,
					signatureHeader: forged,
					nowMs: NOW,
				}),
			).toMatchObject({ ok: false, reason: 'bad_signature' });
		});
	});

	it('reads headers with extra parts and several signatures', () => {
		const parsed = parseSignatureHeader(
			`t=100, v1=${'a'.repeat(64)} ,v0=ignored, v1=${'B'.repeat(64)}`,
		);
		expect(parsed).toEqual({ timestamp: '100', signatures: ['a'.repeat(64), 'b'.repeat(64)] });
		// A rotated secret may send two signatures; either one matching is enough.
		const timestamp = Math.floor(NOW / 1000);
		const good = createHmac('sha256', SECRET).update(`${timestamp}.${BODY}`).digest('hex');
		expect(
			verifyRingeeSignature({
				rawBody: BODY,
				secret: SECRET,
				signatureHeader: `t=${timestamp},v1=${'0'.repeat(64)},v1=${good}`,
				nowMs: NOW,
			}).ok,
		).toBe(true);
	});

	it('verifies the raw bytes, including non-ASCII payloads', () => {
		const body = JSON.stringify({ data: { text: 'Hola, ¿puede asistir mañana? 你好' } });
		expect(
			verifyRingeeSignature({
				rawBody: Buffer.from(body, 'utf8'),
				secret: SECRET,
				signatureHeader: signRingeeBody(body, SECRET, NOW),
				nowMs: NOW,
			}).ok,
		).toBe(true);
	});
});
