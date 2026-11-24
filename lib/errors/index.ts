import type { RingeeErrorBody } from '../types';

export interface DescribedFailure {
	message: string;
	description: string;
	/** True when the same request may succeed if sent again unchanged. */
	retryable: boolean;
}

/** NestJS answers an unknown route with `Cannot GET /path`. */
const MISSING_ROUTE = /^Cannot (GET|POST|PUT|PATCH|DELETE) \//;

export function messageOf(body: unknown): string {
	if (typeof body === 'string') return body.trim();
	if (!body || typeof body !== 'object') return '';
	const { message } = body as RingeeErrorBody;
	if (Array.isArray(message)) return message.join('; ');
	return typeof message === 'string' ? message.trim() : '';
}

function fieldsOf(body: unknown): string {
	if (!body || typeof body !== 'object') return '';
	const { fields } = body as RingeeErrorBody;
	if (!fields || typeof fields !== 'object') return '';
	return Object.entries(fields)
		.map(([name, problem]) => `'${name}': ${Array.isArray(problem) ? problem.join(', ') : problem}`)
		.join('; ');
}

/**
 * Says what Ringee refused, in words a person can act on.
 *
 * Ringee's own message is kept whenever it already says it well; the cases
 * below are the ones that gain from a sentence about what to do next — no
 * credit, a number on the Do-Not-Call list, a key that was rotated, a server
 * too old to know the route.
 */
export function describeRingeeFailure(input: {
	status: number;
	body: unknown;
	retryAfterSeconds?: number;
	/** What a 404 refers to: 'AI voice agent', 'contact', 'call'. */
	subject?: string;
}): DescribedFailure {
	const { status, body, retryAfterSeconds } = input;
	const server = messageOf(body);
	const fields = fieldsOf(body);

	if (status === 404 && MISSING_ROUTE.test(server)) {
		return {
			message: 'This Ringee server does not offer that operation yet',
			description:
				'Your Ringee installation is older than this node expects. Update it, or point the credential at Ringee Cloud (https://api.ringee.io). The operations each version supports are listed in docs/compatibility.md.',
			retryable: false,
		};
	}

	switch (status) {
		case 401:
			return {
				message: 'Ringee did not accept the API key',
				description:
					'Check that the API key in your Ringee credential is the current one and that the Custom Integration it belongs to is enabled. A key that was regenerated in Ringee stops working immediately.',
				retryable: false,
			};
		case 403: {
			if (/insufficient credits/i.test(server)) {
				return {
					message: 'Your Ringee workspace has no credits left',
					description:
						'Add credits in Ringee (Billing), then run the workflow again. Nothing was dialed.',
					retryable: false,
				};
			}
			if (/do-not-call|dnc/i.test(server)) {
				return {
					message: 'That number is on your Do-Not-Call list',
					description: `${server}. Ringee did not place the call. Remove the number from the list in Ringee if the person has agreed to be called.`,
					retryable: false,
				};
			}
			if (/outbound calling is disabled/i.test(server)) {
				return {
					message: 'Outbound calling is turned off for this Ringee account',
					description:
						'Ask the Ringee account owner to enable calling, or contact support@ringee.io.',
					retryable: false,
				};
			}
			if (
				/ai voice agents? (require|are)|voice agents? .*(not|enrolled|organization)/i.test(server)
			) {
				return {
					message: 'AI voice agents are not enabled for this Ringee workspace',
					description: `${server}. Use an API key from a workspace that has AI voice agents.`,
					retryable: false,
				};
			}
			return {
				message: server || 'Ringee refused the request',
				description: 'The API key does not have permission for this action in its workspace.',
				retryable: false,
			};
		}
		case 404:
			return {
				message: `${capitalize(input.subject ?? 'resource')} not found`,
				description: `Ringee has no ${input.subject ?? 'resource'} with that ID in the workspace this API key belongs to. Check the ID, and that the credential points at the right workspace.`,
				retryable: false,
			};
		case 409:
			// The first attempt under this Idempotency Key failed before any call was
			// placed. Retry On Fail repeats the same key, so it gets this answer again:
			// say so, and say what does work.
			if ((body as RingeeErrorBody | undefined)?.code === 'idempotency_key_failed') {
				return {
					message: server || 'The first attempt with this Idempotency Key failed',
					description:
						'Nothing was dialed and nothing was charged. Retry On Fail sends the same key and will get this answer again. Run the workflow again as a new execution, or give the call a new Idempotency Key, to try again.',
					retryable: false,
				};
			}
			return {
				message: server || 'Ringee reported a conflict',
				description:
					'The request conflicts with something that already exists, such as a call started earlier under the same Idempotency Key.',
				retryable: false,
			};
		case 429: {
			const wait = retryAfterSeconds ? ` Try again in ${retryAfterSeconds} seconds.` : '';
			return {
				message: 'Ringee is limiting how fast this integration can call the API',
				description: `Too many requests were sent in a short time.${wait} Use fewer, larger batches or add a Wait node between loops.`,
				retryable: true,
			};
		}
		case 400:
		case 422: {
			const friendly = /is not a dialable phone number/i.test(server)
				? `${server} Use the international format, for example +14155550123.`
				: server;
			return {
				message: friendly || 'Ringee could not use the values that were sent',
				description: fields
					? `Check these fields: ${fields}.`
					: 'Check the values in the node and run it again.',
				retryable: false,
			};
		}
		default:
			if (status >= 500) {
				return {
					message: 'Ringee could not complete the request',
					description: `Ringee answered with HTTP ${status}${server ? `: ${server}` : ''}. This is usually temporary; try again shortly. If it continues, check https://ringee.io or contact support@ringee.io.`,
					retryable: true,
				};
			}
			if (status >= 300 && status < 400) {
				return {
					message: 'Ringee answered with a redirect',
					description:
						'The node never follows redirects, so the API key is not sent anywhere else. Check that the Base URL in the credential is the exact API address, for example https://api.ringee.io.',
					retryable: false,
				};
			}
			return {
				message: server || `Ringee answered with HTTP ${status}`,
				description: 'The request was not accepted.',
				retryable: false,
			};
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
