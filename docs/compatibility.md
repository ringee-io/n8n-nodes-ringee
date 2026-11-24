# Compatibility and API versioning

The node lives in its own repository and talks to Ringee only through its public API and webhooks. This page says which Ringee each operation needs, how the two repositories stay in step, and how versions move.

## Supported versions

| Component    | Supported                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| n8n          | 2.x, community-node API version 1. Tested on n8n 2.x. Using the node as an AI tool needs `usableAsTool`.                           |
| Node.js      | The package runs on Node 20.19 or newer. n8n 2.49 itself requires Node 24 or newer, so a self-hosted n8n runs the node on Node 24. |
| Ringee Cloud | `https://api.ringee.io`, public API `/api/v1`.                                                                                     |
| Self-hosted  | Any Ringee that serves the capabilities below; the Base URL in the credential selects it.                                          |

## Which Ringee each operation needs

A self-hosted Ringee older than a capability answers `404 Cannot GET /api/v1/…`. The node turns that into **"This Ringee server does not offer that operation yet"** with this page as the pointer, instead of a bare 404.

| Capability (Ringee public API)                 | Operations that need it                                                                                             | Introduced in Ringee                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `agents`: AI voice agent routes                | AI Voice Agent → Get Many, Start Call (without key), Get Call Status, Get Call Result, Get Many Calls; Phone Number | Already in Ringee with the public API    |
| `agent-detail`: `GET …/ai-voice-agents/:id`    | AI Voice Agent → Get; the variable fields of Start Call                                                             | The change set that ships with this node |
| `idempotency`: `Idempotency-Key` on Start Call | The replay protection. Without it the header is ignored: **an older Ringee does not deduplicate**                   | The change set that ships with this node |
| `contacts`: `/api/v1/contacts`                 | Contact (all), the contact picker                                                                                   | The change set that ships with this node |
| `calls`: `/api/v1/calls`                       | Call → Get, Get Many; Transcript; Recording                                                                         | The change set that ships with this node |
| `click-to-call`                                | Call → Create Dialer Link                                                                                           | Already in Ringee                        |
| Custom Integration webhooks                    | Ringee Trigger                                                                                                      | Already in Ringee                        |

> **Idempotency on an old server.** The node still sends the `Idempotency-Key` header, and an older Ringee ignores it. Against such a server a retried Start Call can place a second call. Update Ringee before relying on retries, or set **Retry On Fail** off for Start Call. The release notes of the Ringee version that carries `idempotency` will be recorded here.

The credential test reads `/api/v1/contacts`, so on a server without `contacts` it reports that the public API is not offered, which is the right first signal.

## How the two repositories stay in step

Ringee (`ringee-app`) owns the API; this repository owns the node. Neither imports the other.

1. **A Ringee API change that this node uses** is additive (new route, new optional field, new event). Renames and removals break installed workflows and are not allowed without a new `/api/v2`.
2. **Document it first.** Update [api-capability-matrix.md](api-capability-matrix.md) and the types in `lib/types/`, then the code. The mock server in `tests/helpers/mock-ringee.ts` is the executable form of the contract: a change to a response shape changes the mock, the types and the tests together.
3. **Release order:** deploy Ringee, then publish the node that needs it. A node release that needs a capability says so under _Needs Ringee_ in the [changelog](../CHANGELOG.md).
4. **Contract drift** is caught the other way too: Ringee's own tests cover its routes (`apps/backend/src/api/routes/public-*.controller.spec.ts`); this repository's tests cover how the node reads them. When Ringee publishes an OpenAPI document, `lib/types/` should be generated from it and diffed in CI (`docs/api-capability-matrix.md`, gap 4).
5. **Self-hosted users** follow Ringee's `main`. The table above names the capability, not a version number, because Ringee has no release numbers; it will name the first release that has each capability once releases are tagged.

## Node versioning

[Semantic versioning](https://semver.org). The node description `version` is the n8n _node type version_ and stays `1` until a change would alter the behaviour of workflows already saved (a renamed parameter, a changed output shape). Such a change adds a new node version, so existing workflows keep running unchanged.

| Change                                                    | Package version | Node `version` |
| --------------------------------------------------------- | --------------- | -------------- |
| New operation, new optional field, new event, docs, fixes | minor / patch   | unchanged      |
| Output field renamed or removed, default changed          | major           | new            |
