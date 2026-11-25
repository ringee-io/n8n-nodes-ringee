# Reading results: events and polling

A phone call is not instant. Start Call returns an operation that may be queued. If dispatched, the call rings, connects and ends; Ringee's AI then produces a summary, a sentiment and the structured data. This page explains how a workflow should wait for that without polling blindly or running twice.

## The ids you will meet

| Id                       | What it is                                        | Where it appears                                                                  |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `call_id`                | The AI voice agent's run of the call              | Start Call output; `data.call.voiceAgentCall.id` and `data.agentCallId` on events |
| `callId` / `data.callId` | The telephony call itself                         | Event payloads                                                                    |
| `externalId`             | **Your** id, given as _External ID_ to Start Call | `data.externalId` on **every** event the call produces                            |

The Call, Transcript and Recording operations accept **either** call id. To find "the record I started the call for", set **External ID** (for example `reminder-<calendar event id>`) and read it back from `data.externalId`.

## Event first, then read

Keep both an event path and a bounded status path:

1. **Start** the call (`Start Call`, with an External ID and a persistent Idempotency Key). Save `call_id`, the returned state and `expires_at` in your workflow record. A queued response accepts the operation; it does not promise that a call will be dialed.
2. If queued, **Wait** until the deadline or poll **Get Call Status** a fixed number of times. Handle terminal `expired`, `cancelled` and pre-dial `failed` results here: they produce no telephony event. If the call started, continue with the event path or bounded polling; the queue deadline no longer ends a live call. Include a final status check and a branch for an unresolved operation.
3. A separate **Ringee Trigger** workflow reacts when a dialed call ends (`Call Completed`, `Call Failed`), **waits** a minute or two for the AI analysis, then reads the result with **Get Call Result**. Correlate with the saved agent-run `call_id` or External ID. Make the downstream result handler idempotent because the status and event paths can both observe completion.

The following event path handles calls that were dialed. Pair it with step 2 for queued operations; see [queue-and-capacity.md](queue-and-capacity.md).

```text
Ringee Trigger (Call Completed, Call Failed)   filter: only AI agent calls, External ID starts with "reminder-"
  → Wait 2 minutes
  → Get Call Result (call_id = data.call.voiceAgentCall.id)
  → Analysis ready? (outcome is not empty)   no → Wait 5 minutes → Get Call Result → give up if still empty
  → act on the outcome
```

### Why not just listen for `call.outcome.updated`?

Because Ringee publishes it only for outcomes that map to its canonical set: `meeting_booked`, `callback_scheduled`, `not_interested`, `no_answer`, `no_conversation`, `wrong_number`. Agent-specific results — a reminder agent's `confirmed` and `cannot_attend`, `callback_requested`, `unknown` — stay on the agent call and are readable only through **Get Call Result**. `Call Completed` fires for every ended call, so the pattern above covers all outcomes. Where you only care about a canonical outcome (a meeting was booked), `Meeting Created` or `Call Outcome Updated` is simpler.

### "Transcript ready" and "AI analysis completed"

They are not separate events. The transcript travels in `data.call.transcription` of `Recording Ready` and of the call events once it exists; the analysis is in `data.call.voiceAgentCall`. When it is not there yet, wait and use **Transcript → Get** or **Get AI Analysis**. Both answer `ready: false` rather than failing, so a workflow can branch.

## Polling, if you must

Use the trigger for dialed calls and a bounded status path for queued operations that may never dial. Bound polling: a fixed number of attempts with a **Wait** between them (the templates use 2 minutes, then 5), and a branch for "gave up". Never loop without a limit around a paid operation. `Get Call Status` returns `finished` (`true` once the status is `completed`, `no_answer`, `busy`, `voicemail`, `failed`, `cancelled` or `expired`) and `queued` (`true` while Ringee is still waiting for call capacity and nothing has been dialed). A call that is queued, cancelled or expired sends **no event**: see [queue-and-capacity.md](queue-and-capacity.md).

## What the trigger does for you

- Checks the signature over the raw body and the timestamp; refuses anything else with `401`.
- Skips an event id it already ran (Ringee repeats an event whose delivery was not acknowledged in time).
- Filters by event, agent, "only AI calls" and External ID prefix.
- Answers `200` quickly; the workflow runs after.

The repeat guard lives in the workflow's static data: it is a courtesy, not a lock. A workflow that must act **exactly once** (charge, send, dial) should use `eventId` as the idempotency key of that action.

## Setting up the Outbound URL

1. Activate the workflow with the Ringee Trigger.
2. Copy the trigger's **Production URL**.
3. In Ringee: Integrations → Custom Integrations → your integration → **Outbound URL**; tick the same events; copy the **Signing Secret** into the Ringee API credential.
4. Use **Send test** in Ringee. While you build (the _Listen for test event_ button) the sample appears; in production it is acknowledged and ignored.

Ringee sends only to public addresses (it refuses private networks), over HTTP or HTTPS; use HTTPS. For local n8n use a tunnel.

## Verifying a delivery yourself

Outside n8n, the same check in Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret, toleranceSeconds = 300) {
	const t = /t=(\d+)/.exec(header)?.[1];
	const v1 = [...header.matchAll(/v1=([0-9a-f]{64})/g)].map((m) => m[1]);
	if (!t || v1.length === 0 || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds)
		return false;
	const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
	return v1.some((hex) => timingSafeEqual(Buffer.from(hex, 'hex'), expected));
}
```

[`examples/send-test-event.mjs`](../examples/send-test-event.mjs) signs and posts a sample event to your trigger, which is the quickest way to try a workflow without a real call.
