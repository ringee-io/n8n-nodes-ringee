import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { describeRingeeFailure } from '../errors';
import { parseBaseUrl } from '../utils/base-url';

/** Where a request runs from: a node execution or a dropdown loading its options. */
export type RingeeContext = IExecuteFunctions | ILoadOptionsFunctions;

export const CREDENTIAL_NAME = 'ringeeApi';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_SECONDS = 20;
const SAFE_TO_REPEAT: ReadonlySet<string> = new Set(['GET']);
/** Responses that mean "nothing was processed, ask again", valid for any method. */
const NOT_PROCESSED = new Set([429]);
const TRANSIENT = new Set([502, 503, 504]);

export interface RingeeRequest {
	method: IHttpRequestMethods;
	/** Path below `/api`, such as `/v1/contacts`. */
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	headers?: Record<string, string>;
	/** Sent as the `Idempotency-Key` header. */
	idempotencyKey?: string;
	itemIndex?: number;
	/** What a 404 refers to, for the message. */
	subject?: string;
	timeoutMs?: number;
}

interface RawResponse {
	statusCode: number;
	headers: Record<string, string | string[] | undefined>;
	body: unknown;
}

/**
 * One request to Ringee's public API, with everything that must be true of every
 * request decided in one place:
 *
 * - the API key is added by n8n from the credential, never read or logged here;
 * - the Base URL is validated, and redirects are never followed, so the key
 *   cannot be handed to another host;
 * - failures become `NodeApiError`s with a message that says what to do;
 * - only requests that are safe to repeat are repeated (see `shouldRetry`).
 */
export async function ringeeRequest<T = IDataObject>(
	ctx: RingeeContext,
	request: RingeeRequest,
): Promise<T> {
	const response = await send(ctx, request, 'json');
	return response.body as T;
}

/** A request whose answer is a file, such as a recording. */
export async function ringeeRequestBinary(
	ctx: RingeeContext,
	request: RingeeRequest,
): Promise<{ data: Buffer; contentType?: string; contentDisposition?: string }> {
	const response = await send(ctx, request, 'arraybuffer');
	const body = response.body;
	const data = Buffer.isBuffer(body) ? body : Buffer.from(body as ArrayBuffer);
	return {
		data,
		contentType: headerValue(response.headers['content-type']),
		contentDisposition: headerValue(response.headers['content-disposition']),
	};
}

/**
 * Every item of a paged list, or the first `limit` of them.
 * Ringee pages are `{ data, total, page, limit }`.
 *
 * Ringee pages by `skip = (page - 1) * limit`, so every request must use the
 * same `limit` for the pages to tile the list: shrinking it on the last page to
 * "ask for no more than needed" makes page 2 start inside page 1 and repeats
 * rows. One page size is chosen up front and the surplus is cut off at the end.
 */
export async function ringeeRequestAllItems<T>(
	ctx: RingeeContext,
	request: RingeeRequest,
	options: { returnAll: boolean; limit?: number; pageSize?: number } = { returnAll: true },
): Promise<T[]> {
	const maxPageSize = options.pageSize ?? 100;
	const wanted = options.returnAll ? Infinity : Math.max(1, options.limit ?? 50);
	const pageSize = Math.min(maxPageSize, wanted);
	const items: T[] = [];
	let page = 1;

	for (;;) {
		const response = await ringeeRequest<{ data: T[]; total?: number }>(ctx, {
			...request,
			qs: { ...request.qs, page, limit: pageSize },
		});
		const batch = Array.isArray(response?.data) ? response.data : [];
		items.push(...batch);

		const reachedTotal = typeof response?.total === 'number' && items.length >= response.total;
		if (batch.length < pageSize || reachedTotal || items.length >= wanted) break;
		page += 1;
	}
	return items.slice(0, wanted === Infinity ? undefined : wanted);
}

async function send(
	ctx: RingeeContext,
	request: RingeeRequest,
	encoding: 'json' | 'arraybuffer',
): Promise<RawResponse> {
	const credentials = await ctx.getCredentials(CREDENTIAL_NAME);
	const parsed = parseBaseUrl(credentials.baseUrl as string | undefined);
	if (!parsed.ok) {
		throw new NodeOperationError(ctx.getNode(), parsed.message, {
			itemIndex: request.itemIndex,
			description: 'Fix the Base URL in your Ringee credential.',
		});
	}
	const baseUrl = parsed.url;

	const headers: Record<string, string> = {
		Accept: encoding === 'json' ? 'application/json' : '*/*',
		...request.headers,
	};
	if (request.idempotencyKey) headers['Idempotency-Key'] = request.idempotencyKey;

	const options: IHttpRequestOptions = {
		method: request.method,
		url: `${baseUrl}/api${request.path}`,
		headers,
		qs: request.qs,
		body: request.body,
		json: encoding === 'json',
		encoding: encoding === 'json' ? 'json' : 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		// The API key must only ever reach the host the credential names.
		disableFollowRedirect: true,
		timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	};

	for (let attempt = 0; ; attempt++) {
		let response: RawResponse | undefined;
		let networkFailure: unknown;
		try {
			response = (await ctx.helpers.httpRequestWithAuthentication.call(
				ctx,
				CREDENTIAL_NAME,
				options,
			)) as RawResponse;
		} catch (error) {
			networkFailure = error;
		}

		if (response && response.statusCode >= 200 && response.statusCode < 300) return response;

		const status = response?.statusCode;
		if (
			attempt < MAX_RETRIES &&
			shouldRetry(request.method, status) &&
			!isCapacityRefusal(status, response?.body)
		) {
			await sleep(retryDelayMs(response, attempt));
			continue;
		}

		if (!response) {
			throw new NodeApiError(ctx.getNode(), networkFailure as JsonObject, {
				itemIndex: request.itemIndex,
				message: 'Could not reach Ringee',
				description: `Check your connection and the Base URL in the credential (${baseUrl}). ${
					(networkFailure as Error)?.message ?? ''
				}`.trim(),
			});
		}

		throw toApiError(ctx, request, response, encoding);
	}
}

/**
 * Whether a response or a dropped connection may be answered by sending the
 * request again.
 *
 * `429` means the rate limit refused it before anything ran, so it is safe for
 * every method. A gateway answer (502/503/504) or a dropped connection leaves it
 * unknown whether the work happened, so those are repeated for reads only: a
 * second Start Call after a timeout could be a second paid call, and it is the
 * Idempotency Key — not a blind retry — that makes repeating one safe.
 */
export function shouldRetry(method: string, status: number | undefined): boolean {
	if (status === undefined) return SAFE_TO_REPEAT.has(method);
	if (NOT_PROCESSED.has(status)) return true;
	return TRANSIENT.has(status) && SAFE_TO_REPEAT.has(method);
}

/**
 * A `429` that says Ringee's CALL CAPACITY is spent, not that the API was asked
 * too often. The first clears in seconds; this one clears when calls finish, so
 * retrying it a second later only holds the workflow up. It is raised at once,
 * and the workflow decides how long to wait.
 */
export function isCapacityRefusal(status: number | undefined, body: unknown): boolean {
	if (status !== 429 || !body || typeof body !== 'object') return false;
	const code = (body as { code?: unknown }).code;
	return code === 'dispatch_queue_full' || code === 'dispatch_deferred';
}

function retryDelayMs(response: RawResponse | undefined, attempt: number): number {
	const header = response ? headerValue(response.headers['retry-after']) : undefined;
	const seconds = header !== undefined ? Number(header) : NaN;
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.min(seconds, MAX_RETRY_WAIT_SECONDS) * 1000;
	}
	return Math.min(1000 * 2 ** attempt, MAX_RETRY_WAIT_SECONDS * 1000);
}

function toApiError(
	ctx: RingeeContext,
	request: RingeeRequest,
	response: RawResponse,
	encoding: 'json' | 'arraybuffer',
): NodeApiError {
	const body = encoding === 'arraybuffer' ? decodeErrorBody(response.body) : response.body;
	const retryAfter = Number(headerValue(response.headers['retry-after']));
	const described = describeRingeeFailure({
		status: response.statusCode,
		body,
		retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : undefined,
		subject: request.subject,
	});
	return new NodeApiError(ctx.getNode(), { statusCode: response.statusCode, body } as JsonObject, {
		message: described.message,
		description: described.description,
		httpCode: String(response.statusCode),
		itemIndex: request.itemIndex,
	});
}

function decodeErrorBody(body: unknown): unknown {
	try {
		const text = Buffer.isBuffer(body)
			? body.toString('utf8')
			: Buffer.from(body as ArrayBuffer).toString('utf8');
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function headerValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}
