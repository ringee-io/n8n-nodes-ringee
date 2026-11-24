/** What Ringee accepts as an Idempotency-Key: 1 to 255 of these characters. */
const KEY_PATTERN = /^[A-Za-z0-9._:@/+=~-]{1,255}$/;

export function isValidIdempotencyKey(key: string): boolean {
	return KEY_PATTERN.test(key);
}

export interface IdempotencyContext {
	workflowId?: string;
	executionId?: string;
	nodeId?: string;
	runIndex?: number;
	itemIndex: number;
	/**
	 * Names what the call is about instead of which run of the node made it.
	 * Used when an AI model decides to call: it may ask for the same call twice
	 * in one answer, and each ask is a new run of the node, so the run index
	 * cannot tell a repeat from a second person.
	 */
	operation?: string;
}

/**
 * The key a Start Call sends when the user did not choose one.
 *
 * It names one attempt to place one call: this workflow, this execution, this
 * node, this run of the node and this input item. n8n's *Retry On Fail*, a
 * timed-out request sent again, and an execution that resumes after a restart
 * all repeat the same attempt and so carry the same key — Ringee then answers
 * with the call it already placed instead of dialing again.
 *
 * Two different calls never share one: a *Loop Over Items* iteration has a new
 * run index, and every item has its own index. Without an execution id (some
 * manual runs) there is nothing stable to name the attempt by, so no key is
 * produced rather than one that could swallow a later, different call.
 *
 * When an AI model places the call (`operation` is given) the key names the
 * call itself, not the run: the same destination asked for twice in one
 * execution is one call, a different destination is another.
 */
export function automaticIdempotencyKey(context: IdempotencyContext): string | undefined {
	const { workflowId, executionId, nodeId, runIndex, itemIndex, operation } = context;
	if (!workflowId || !executionId || !nodeId) return undefined;
	const attempt = operation ? [`op-${operation}`] : [`r${runIndex ?? 0}`, `i${itemIndex}`];
	const key = ['n8n', workflowId, executionId, nodeId, ...attempt].join(':');
	return isValidIdempotencyKey(key) ? key : undefined;
}
