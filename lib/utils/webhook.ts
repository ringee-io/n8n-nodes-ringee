import { createHmac, timingSafeEqual } from 'crypto';

/** How far a delivery's timestamp may be from now, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
	| 'missing_secret'
	| 'missing_signature'
	| 'malformed_signature'
	| 'timestamp_out_of_range'
	| 'bad_signature';

export interface SignatureResult {
	ok: boolean;
	reason?: SignatureFailure;
	/** Seconds since the epoch, as signed. */
	timestamp?: number;
}

/** `t=<unix seconds>,v1=<hex>` (more than one `v1` is allowed). */
export function parseSignatureHeader(
	header: string,
): { timestamp: string; signatures: string[] } | null {
	let timestamp: string | undefined;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, ...rest] = part.trim().split('=');
		const value = rest.join('=');
		if (key === 't' && /^\d{1,12}$/.test(value)) timestamp = value;
		if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
	}
	if (!timestamp || signatures.length === 0) return null;
	return { timestamp, signatures };
}

/**
 * Verifies a Ringee webhook delivery.
 *
 * Ringee signs `HMAC-SHA256(secret, "<timestamp>.<raw body>")` and sends
 * `Ringee-Signature: t=<timestamp>,v1=<hex>`. The check runs on the bytes that
 * were received — re-serializing parsed JSON would change them — and compares
 * in constant time. A missing secret, a missing or malformed header and a
 * timestamp outside the tolerance all fail: nothing is accepted by default.
 *
 * The timestamp is part of what is signed, so a captured delivery cannot be
 * replayed later with a fresh timestamp, only inside the tolerance window, where
 * the event id lets the caller drop the repeat.
 */
export function verifyRingeeSignature(input: {
	rawBody: Buffer | string;
	secret: string | undefined;
	signatureHeader: string | undefined;
	nowMs?: number;
	toleranceSeconds?: number;
}): SignatureResult {
	const secret = input.secret?.trim();
	if (!secret) return { ok: false, reason: 'missing_secret' };
	if (!input.signatureHeader) return { ok: false, reason: 'missing_signature' };

	const parsed = parseSignatureHeader(input.signatureHeader);
	if (!parsed) return { ok: false, reason: 'malformed_signature' };

	const timestamp = Number(parsed.timestamp);
	const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
	const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
	if (Math.abs(nowSeconds - timestamp) > tolerance) {
		return { ok: false, reason: 'timestamp_out_of_range', timestamp };
	}

	const body = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, 'utf8');
	const expected = createHmac('sha256', secret)
		.update(`${parsed.timestamp}.`)
		.update(body)
		.digest();

	const matches = parsed.signatures.some((candidate) => {
		const given = Buffer.from(candidate, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
	return matches ? { ok: true, timestamp } : { ok: false, reason: 'bad_signature', timestamp };
}

/** The wire form of a signature, for tests and for documentation snippets. */
export function signRingeeBody(body: string, secret: string, nowMs = Date.now()): string {
	const timestamp = Math.floor(nowMs / 1000).toString();
	const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
	return `t=${timestamp},v1=${digest}`;
}
