# Call capacity, queued calls and safe batches

Ringee does not dial every call the instant it is asked to. Phone calls leave Ringee through a provider account that bills for how fast calls are _started_, so Ringee paces them. When a call has to wait its turn, Start Call says so, honestly, and returns at once. This page explains what you see, what it means, and how to build workflows that stay correct when a batch is large.

With queueing enabled, even an idle Ringee returns a durable queued operation immediately. Older servers and servers with queueing disabled can still return initiating. Branch on the returned state.

## What Start Call returns

| Ringee answers              | `status`     | `queued` | Meaning                                                                                   |
| --------------------------- | ------------ | -------- | ----------------------------------------------------------------------------------------- |
| `201`                       | `initiating` | `false`  | The call was placed. The conversation happens now; the result arrives later.              |
| `202`                       | `queued`     | `true`   | Accepted, **not dialed**. It is waiting for call capacity. Nothing has been charged.      |
| `429` `dispatch_queue_full` | —            | —        | Ringee already has as many calls waiting as it allows for this workspace. Nothing queued. |
| `429` `dispatch_deferred`   | —            | —        | No capacity is free right now and this kind of call does not wait. Nothing dialed.        |

A queued call has an `expires_at`. If it has not been dialed by then it gives up and is **never** dialed late.

```json
{
	"call_id": "5a6bb1fc-00ea-4996-8fe4-0a221d047162",
	"status": "queued",
	"finished": false,
	"queued": true,
	"queued_at": "2026-12-01T14:00:00.000Z",
	"expires_at": "2026-12-01T16:00:00.000Z",
	"idempotent_replayed": false
}
```

## The states of a call

```
queued ──► initiating ──► ringing ──► in_progress ──► completed
   │                                              └─► no_answer · busy · voicemail · failed
   ├──► cancelled     you withdrew it before it was dialed
   ├──► expired       it waited past its limit and was never dialed
   └──► failed        a rule refused it at the last moment (no credits, Do-Not-Call, number removed)
```

- **Final** states (`finished: true`): `completed`, `no_answer`, `busy`, `voicemail`, `failed`, `cancelled`, `expired`.
- **Never dialed, never charged:** `queued`, `cancelled`, `expired`.
- Before a queued call is dialed Ringee checks everything again: the balance, the Do-Not-Call list, the agent and the caller number. A rule that says no ends the call as `failed` with the reason, and it is not retried.

## What the Ringee Trigger sends, and what it does not

The events (`call.completed`, `call.failed`, …) describe calls that were **dialed**. A call that is queued, cancelled or expired has no telephone call behind it, so **no event is sent** for those three states. A queued call that is later dialed behaves exactly like any other: correlate its events with the agent-run ID in `data.agentCallId` or `data.call.voiceAgentCall.id`, or with your `data.externalId`. Start Call returns the agent-run `call_id`; event `data.callId` identifies a different telephony record.

A trigger-based workflow must also save the operation ID and deadline and run a bounded **Get Call Status** check. After `expires_at`, an operation still waiting becomes `expired`; it may instead already be `cancelled`, `failed` or completed. Handle each terminal state. If it started before the deadline and is still dialing or live, continue through the event path or bounded polling. Never assume that every accepted operation produces an event.

## Cancel Call

`AI Voice Agent → Cancel Call` withdraws a call that is still waiting. It answers `{ call_id, status: "cancelled", finished: true }`.

- A call that is already dialing cannot be cancelled this way: Ringee answers `409` (`call_not_cancellable`). Hang it up in Ringee.
- A second cancel answers the same `409`; it never cancels twice.
- A call of another workspace is not found.

## Safe batches

A loop over thousands of leads should never depend on Ringee dialing them all at once. Three limits apply, and a good workflow expects each:

1. **Pacing.** Ringee starts a limited number of calls per second across everyone, and a smaller number per workspace. Calls beyond that wait in the queue in fair order (a workspace with a huge batch does not push another's single call behind it).
2. **Live calls.** A workspace can have only so many AI calls live at once (25 by default). The rest wait for a slot.
3. **Queue size.** Each workspace can have a bounded number of calls waiting. Past it Start Call answers `429 dispatch_queue_full`.

### Recommended pattern

```
Schedule / trigger
  └─ Loop Over Items          (batch size 25–50)
       ├─ Ringee → Start Call   (Retry On Fail: off; On Error: continue (using error output))
       │    ├─ success ─────────► Set: remember call_id
       │    └─ error output ────► (see "When Start Call is refused")
       └─ Wait 10–30 s            (between batches, so the queue is never the thing that fills)
```

- An empty **Idempotency Key** protects retries within the same execution only; its generated key includes the execution ID. To protect across re-runs, require a persistent record-based key such as `lead-{{ $json.id }}`. Keep that key on every retry of the same intended call. A new execution ID, timestamp or random value creates a new attempt and can dial the person again.
- Keep **Retry On Fail off in this capacity-aware pattern**. Route capacity errors through the error branch, wait at least the reported delay and retry with the same persistent key, with a fixed maximum attempt count. The client already bounds generic API-rate-limit retries. Do not wrap Start Call in an endless loop.
- Prefer **fewer, larger waits** to a tight loop. Queued calls are cheap; a thousand requests in a second are not necessary.

### When Start Call is refused

| Error                                                         | Nothing was…              | What to do                                                                                                                                                                                             |
| ------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `429` queue full                                              | queued, dialed or charged | Wait the number of seconds in the message, then run the same item again with the **same** key. Send smaller batches.                                                                                   |
| `429` no capacity (deferred)                                  | dialed or charged         | Same. This kind of call is not queued; retry after the wait.                                                                                                                                           |
| `403` no credits / Do-Not-Call                                | dialed or charged         | Fix the cause. Retrying does not help.                                                                                                                                                                 |
| `409` `idempotency_key_failed`                                | dialed or charged         | The first try failed before dialing. Use a deliberate new key for a new intended call. A new execution changes only automatic keys; persistent explicit keys must be changed.                          |
| `409` `idempotency_key_cancelled` / `idempotency_key_expired` | dialed or charged         | It was withdrawn or gave up. Use a new key to place it again.                                                                                                                                          |
| Timeout, `502`, `503`, `504`                                  | known                     | The operation **may** exist. Retry with the **same persistent key**; handle a new acceptance if nothing reached Ringee, or an idempotent replay of the accepted operation. Never substitute a new key. |

### Retrying with the same key

A retry under the key of an earlier attempt never places a second call. What it returns depends on where the first attempt got to. Ringee reads the call as it is **now**, so a call that has since expired is not answered with its old `queued` response:

| The first attempt is…                        | The retry answers                                                                                                        | In a workflow                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| still queued                                 | `200`, `status: queued`, `idempotent_replayed: true`, and the **original** `queued_at` and `expires_at`                  | The queue watcher follows it.                                                                    |
| dialed (live or finished)                    | `200`, the call's current status, `idempotent_replayed: true`                                                            | The event and result branch owns it; the watcher stays out.                                      |
| cancelled, expired, or failed before dialing | `409` `idempotency_key_cancelled`, `idempotency_key_expired` or `idempotency_key_failed`. **No status body is returned** | Start Call's **error output** (or a failed run). It never reaches **Was the operation queued?**. |

So that selector only ever sees a call that is waiting or was dialed; a persistent key retried after its call expired is an error you route, not a status you must classify. Give Start Call an error output you will notice, and use a new key to place the call again.

### Polling a call that may be queued

If you poll instead of using the Trigger, bound it and branch on the state:

1. **Get Call Status** after a short Wait.
2. `finished: true` → handle the result (note `cancelled` and `expired` mean it was never dialed).
3. `queued: true` → it is still waiting. Wait again, **but only until `expires_at`**; after that Get Call Status expires an operation that is still queued and reports `expired`.
4. Anything else → it is dialing or live; wait for the event or the next poll.

Use a fixed number of rounds and a branch for "gave up". Never loop without a limit around a paid operation.

## What the AI Agent tool does

When an AI agent uses Start Call as a tool, a `queued` answer is a successful one: the operation was accepted and may be dialed after dispatch-time checks. It can also expire, be cancelled or fail admission. Require a bounded status check before treating the conversation as completed. The tool returns `queued: true` and `expires_at`; instruct the agent not to start the same call again. The node's key for tool calls names the destination, so a model that asks twice does not place two calls.

## For operators of Ringee

The queue and the pacing behind it are described in Ringee's `docs/telnyx-cps-cost-protection.md`. The node needs a Ringee that reports the `queuedCalls` capability (`GET /api/v1/capabilities`) for **Cancel Call**; Start Call works against a server without queueing only when it still advertises `idempotentCalls`. A server without that capability is refused before dialing.

## Triggers and calls that never dial

Existing call events describe actual telephony calls. A queued operation that expires, is cancelled or fails before a provider attempt does not produce `call.completed` or an AI outcome. Do not wait only for the Trigger in these cases: keep the operation ID and deadline, and use bounded Get Call Status polling to close the workflow. A `queued` result is successful acceptance and must not start the same call again.

## Template deadline watchers

Every direct Start Call template now has a separate queued-status branch. It retains the ID and deadline, waits once (bounded to 24 hours plus one second), and reads status even when no event is sent. Its final output records the actual status and `needs_attention` for expired, cancelled, failed or unresolved operations. Attach your own idempotent follow-up to that output when needed; it does not retry Start Call or duplicate the event branch's CRM writes. The revised templates have structural/expression tests, but have not been reimported into a real n8n worker or tested across worker restarts.

### Why the watcher is the last branch, and what sits beside it

n8n runs the branches that leave one node **one after the other**, topmost first (leftmost at the same height), and a node that fails stops the whole run: every branch still waiting its turn is abandoned. The watcher hangs off Start Call beside whatever else the template does with the new call, so the templates protect it from both effects:

- **It is the lowest branch.** The step beside it runs first: the two-minute result read in the Quick start, the sheet update in lead qualification, the log row in the missed-call callback. Do not move the watcher above it. Its Wait, up to 24 hours, would hold that work back.
- **What runs before it continues on its error output**, into a node that says what failed (`Result not read: see the error`, `Row not marked: see the error`, `Callback not logged: see the error`). The failure is reported there and the watcher still runs. The repository tests compute n8n's run order for every template and fail if a step that can fail runs before the watcher without that error output.

If you add a step beside the watcher, do the same: set **On Error** to _Continue (using error output)_ and connect that output to something you will notice. An uncaught failure there silently removes the status check for every call queued in that run.

The watcher reads the deadline from Start Call's own answer (`expires_at`, also present on a replay). A queued answer without one would make the watcher check at once and report `unresolved_inspect_ringee` with `needs_attention: true`: a signal to look in Ringee, never a silent pass. Ringee always sends `expires_at` with a queued call.
