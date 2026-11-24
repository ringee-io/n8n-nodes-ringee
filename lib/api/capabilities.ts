import { createHash } from 'crypto';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type { JsonObject } from 'n8n-workflow';
import { CREDENTIAL_NAME, ringeeRequest, type RingeeContext } from './client';

/** What a Ringee server can promise, as `GET /api/v1/capabilities` reports it. */
export type RingeeCapability = 'idempotentCalls' | 'agentDetail' | 'contacts' | 'calls';

interface CapabilitiesResponse {
	apiVersion?: number;
	capabilities?: Partial<Record<RingeeCapability, boolean>>;
}

/** How long a confirmed capability is trusted before it is asked for again. */
const TRUST_MS = 5 * 60 * 1000;
const confirmed = new Map<string, number>();

/**
 * Refuses to go on unless the Ringee server says it keeps a promise this node
 * relies on.
 *
 * The one that matters is `idempotentCalls`. A Ringee that predates it does not
 * reject the `Idempotency-Key` header, it ignores it, so a retried Start Call
 * places a second paid call and nothing says so. Asking first turns that silent
 * failure into an error before any call is placed. A server too old to have the
 * route at all answers `404`, which is the same answer.
 *
 * What was confirmed is remembered per server and key for a few minutes, so a
 * loop over thousands of items asks once. Only a confirmation is remembered: a
 * refusal is asked again next time, because the server may have been updated.
 */
export async function requireCapability(
	ctx: RingeeContext,
	capability: RingeeCapability,
	itemIndex?: number,
): Promise<void> {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
	// Hashed, so nothing secret is kept as a key and nothing is ever logged.
	const identity = createHash('sha256')
		.update(
			`${String(credentials.baseUrl ?? '')}\n${String(credentials.apiKey ?? '')}\n${capability}`,
		)
		.digest('hex');
	const now = Date.now();
	if ((confirmed.get(identity) ?? 0) > now) return;

	let report: CapabilitiesResponse | undefined;
	try {
		report = await ringeeRequest<CapabilitiesResponse>(ctx, {
			method: 'GET',
			path: '/v1/capabilities',
			itemIndex,
			subject: 'capabilities',
		});
	} catch (error) {
		if (error instanceof NodeApiError) {
			// Not found: a Ringee that predates the route, and so the guarantee.
			if (String(error.httpCode) === '404') throw tooOld(ctx, capability, itemIndex);
			// Wrapping an error of the same class returns it as it was.
			throw new NodeApiError(ctx.getNode(), error as unknown as JsonObject);
		}
		if (error instanceof NodeOperationError) throw new NodeOperationError(ctx.getNode(), error);
		throw new NodeOperationError(ctx.getNode(), error as Error, { itemIndex });
	}

	if (report?.capabilities?.[capability] !== true) throw tooOld(ctx, capability, itemIndex);
	confirmed.set(identity, now + TRUST_MS);
}

/** Forgets every confirmation. For tests. */
export function forgetCapabilities(): void {
	confirmed.clear();
}

function tooOld(
	ctx: RingeeContext,
	capability: RingeeCapability,
	itemIndex: number | undefined,
): NodeOperationError {
	const consequence =
		capability === 'idempotentCalls'
			? 'It does not confirm that it honors the Idempotency-Key header, so a retried Start Call could place a second paid call. Nothing was dialed.'
			: 'It does not confirm that it offers this operation.';
	return new NodeOperationError(ctx.getNode(), 'This Ringee server is too old for this operation', {
		itemIndex,
		description: `${consequence} Update Ringee, or point the Base URL of the credential at Ringee Cloud (https://api.ringee.io). The versions each operation needs are listed in docs/compatibility.md.`,
	});
}
