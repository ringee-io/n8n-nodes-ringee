/** How long an event id is remembered, and how many are kept. */
export const SEEN_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
export const SEEN_EVENT_MAX = 1000;

/** Event ids already delivered to a workflow, with when each arrived. */
export type SeenEvents = Record<string, number>;

/**
 * Records an event id and reports whether it was seen before.
 *
 * Ringee delivers each event at least once: a response that arrives late, or
 * not at all, makes it send the same event again with the same id. The store is
 * small, pruned by age and by count, and lives in the workflow's own static
 * data, so it needs no external service. It is a courtesy against repeats, not
 * a lock — two deliveries that arrive at the same instant can both pass — so a
 * workflow that must act exactly once should also use `eventId` as the
 * idempotency key of what it does (see docs/idempotency.md).
 */
export function markEventSeen(
	seen: SeenEvents,
	eventId: string,
	nowMs: number = Date.now(),
): { duplicate: boolean; seen: SeenEvents } {
	const live: SeenEvents = {};
	for (const [id, at] of Object.entries(seen)) {
		if (nowMs - at < SEEN_EVENT_TTL_MS) live[id] = at;
	}
	if (eventId in live) return { duplicate: true, seen: live };

	live[eventId] = nowMs;
	const entries = Object.entries(live);
	if (entries.length > SEEN_EVENT_MAX) {
		entries.sort((a, b) => b[1] - a[1]);
		return { duplicate: false, seen: Object.fromEntries(entries.slice(0, SEEN_EVENT_MAX)) };
	}
	return { duplicate: false, seen: live };
}
