# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com), versions follow [semver](https://semver.org). A release that needs a newer Ringee says so under **Needs Ringee**.

## [0.1.2] - 2026-11-26

### Changed

- Support contact is now **hello@ringee.io** (package author, `SECURITY.md`, and the two error messages that point users to support).

## [0.1.1] - 2026-11-26

Same code as 0.1.0, published from GitHub Actions with an npm provenance statement so n8n can verify it. Use this version, not 0.1.0.

## [0.1.0] - 2026-11-26

First version. Published from a local machine without npm provenance, so n8n cannot verify it; superseded by 0.1.1.

### Added

- **Ringee API credential** (API key, Base URL, webhook signing secret) with a connection test.
- **Ringee node** with six resources:
  - AI Voice Agent: Get, Get Many, **Start Call** (idempotent, with agent-specific variable fields), **Cancel Call**, Get Call Status, Get Call Result, Get Many Calls.
  - Call: Get, Get Many, Create Dialer Link.
  - Contact: Create, Create or Update, Get, Get Many, Update, Delete.
  - Phone Number: Get, Get Many.
  - Recording: Get, Download (binary).
  - Transcript: Get, Get AI Analysis, Get Summary, Get Extracted Information.
- **Ringee Trigger** for nine events, with signature verification, replay protection, duplicate skipping and filters.
- **AI Agent tool** variant; Delete is not offered to AI agents.
- Twelve workflow templates and a catalog, one built only from HTTP Request nodes.
- Typed API layer with paging, safe retries, rate-limit handling and error messages that say what to do.
- **Queued calls**: when Ringee has to wait for call capacity, Start Call returns `status: queued` (`queued: true`, `queued_at`, `expires_at`) instead of pretending the call started; Get Call Status and Get Call Result report the same; **Cancel Call** withdraws a call that has not been dialed. A full queue is raised at once with the time to wait, never retried blindly. See [docs/queue-and-capacity.md](docs/queue-and-capacity.md).
- **Queue watcher isolation** in the templates: the step beside the queue status check (Get call result in the Quick start, the sheet update in lead qualification, the log write in the missed-call callback) continues on its own error output, so a failure there can no longer stop the check. The retry contract for a same-key repeat is documented ([retrying with the same key](docs/queue-and-capacity.md#retrying-with-the-same-key)).

### Needs Ringee

The public API additions that ship with this node (`ringee-app`, deployed on api.ringee.io; all five capabilities confirmed through `GET /api/v1/capabilities` on 2026-11-26): `GET /api/v1/ai-voice-agents/:id`, the `Idempotency-Key` header on Start Call, `/api/v1/contacts`, `/api/v1/calls`, and, for queued calls, `202 queued` on Start Call, `POST /api/v1/ai-voice-agents/calls/:id/cancel` and the `queuedCalls` capability. See [docs/compatibility.md](docs/compatibility.md).

### Known limits

- No automatic webhook registration ([proposal](docs/webhook-subscriptions-proposal.md)).
- No contact-list, campaign or meeting operations: Ringee has no public API for them ([matrix](docs/api-capability-matrix.md)).
- AI tool `Output` selector and Contact `Simplify` are not implemented yet.

- Start Call refuses a manual execution without a stable automatic or explicit idempotency key. Queue deadlines remain available across replay and status/result reads.
