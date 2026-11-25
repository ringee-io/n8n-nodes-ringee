# Idempotency: never a second paid call

Starting an AI call costs money and reaches a person. Networks time out, n8n retries, executions resume, webhooks repeat. This page says exactly what stops those from placing a second call, and where the protection ends.

## The mechanism

`POST /api/v1/ai-voice-agents/:agentId/calls` accepts an optional **`Idempotency-Key`** header (1–255 characters of `A-Z a-z 0-9 . _ : @ / + = ~ -`).

- **First request with a key:** Ringee stores a durable operation with that key after admission checks. With queueing enabled it returns `202 queued` before dialing; dispatch checks permission, Do-Not-Call, balance and caller ID again. A queue-disabled server can place the call inline and return `201 initiating`.
- **Any later request with the same key:** answered **before** the gates, with the original call and `idempotent_replayed: true` (HTTP `200`, header `Idempotent-Replayed: true`). Nothing is dialed. It still answers if the balance dropped or the number joined the Do-Not-Call list since: it is the same call.
- **Same key, different agent or number:** refused (`422`), never answered with the wrong call.
- **Scope:** the key is namespaced by the authenticated integration and hashed (`client:<integration id>:<sha-256>`). Two integrations can use the same key; a client can never collide with Ringee's own keys.
- **A first attempt that failed before dialing** normally stays attached to its key, and a retry under that key is **refused** (`409`, `idempotency_key_failed`: "Nothing was dialed"). It is never answered as a success. **Retry On Fail repeats the same key, so it gets the same refusal**: a new execution changes an automatic key only. If you supplied a persistent explicit key, deliberately change it to name a new intended call; a new execution with the same explicit key receives the same refusal. A call that was dialed and then ended badly (busy, no answer, voicemail, failed) is answered normally, as that call.
- **A crash between reserving the key and the provider answering** leaves the call as `created`. A repeat answers with it and never dials, because the call may already be live. If a call stays `created` for minutes and no event ever arrives, check it in Ringee; the node cannot know whether it was dialed.
- **The key names the operation, not the payload.** The same key with different variables answers with the first call. Keys do not expire.
- **The server is asked first.** Before the first Start Call the node reads `GET /api/v1/capabilities` and refuses to dial unless the server confirms `idempotentCalls` (an older Ringee ignores the header silently). The answer is remembered for five minutes per server and key.

Without the header, Ringee behaves exactly as before.

## What the node sends

| Situation                                            | Key                                                                     | Protects against                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| You set **Idempotency Key**                          | Yours, for example `reminder-<event id>`                                | Everything below, **and** the same thing being called twice by different executions, schedule overlaps or re-imported rows |
| You leave it empty                                   | `n8n:<workflow id>:<execution id>:<node id>:r<run index>:i<item index>` | **Retry On Fail**, a timeout followed by a retry, a resumed execution                                                      |
| Empty, and no stable execution id (rare manual runs) | none                                                                    | the paid request is refused; enter an explicit persistent key                                                              |

A **new run index** (each iteration of _Loop Over Items_), a **new item index** and a **new execution** produce a new automatic key, so they place a new call. That is deliberate: they are different attempts. To make "one call per thing" hold across executions, set the key yourself.

## What the node never does

- It never resends a write on its own because a connection dropped or a server answered `502/503/504`: it cannot know the call was not placed. Retrying is n8n's **Retry On Fail**, and it is safe because the key is the same.
- It does resend a request Ringee answered with `429`: the rate limiter refused it before anything ran. It waits as `Retry-After` says, at most 20 seconds, twice.
- It does **not** resend a `429` that says Ringee's call capacity is spent (`dispatch_queue_full`, `dispatch_deferred`). It raises the error immediately with the delay. Retry a bounded number of times after that delay with the **same persistent key**. Queue saturation creates no operation. An inline CPS denial proven to occur before any provider request retains its failed history record but atomically retires that record's key, allowing the same key to retry. Other failures retain the binding: `409 idempotency_key_failed` requires a deliberate new call and a new key. A provider timeout or ambiguous response never releases a key.
- A key whose call was **cancelled** or **expired** in the queue answers `409 idempotency_key_cancelled` / `idempotency_key_expired`: the call was never dialed, and the key will not quietly place it. Use a new key to place it again. It is an error, not a status: in a workflow it arrives on Start Call's error output (or stops the run), never as an answer the queue watcher has to classify ([retrying with the same key](queue-and-capacity.md#retrying-with-the-same-key)).
- It retries reads (`GET`) on `429/502/503/504` and dropped connections, twice.

## The trigger side

`Ringee Trigger` skips an event id it already ran. It is best effort (two deliveries at the same instant can both pass), so a downstream **paid or irreversible** action should use `eventId` as its own idempotency key. For a callback after a missed call, the template uses `callback-<missed call id>`.

## Test it

The test suite drives these cases against a mock Ringee over real HTTP: `tests/ringee-node.test.ts` ("does not dial twice when the answer to a call that was placed never arrives", the replay, the loop, the multi-item cases). In a real n8n the same scenario was run with **Retry On Fail** enabled and a response dropped after the call was placed: two requests, one key, one call.
