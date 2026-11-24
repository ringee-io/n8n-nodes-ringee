# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com), versions follow [semver](https://semver.org). A release that needs a newer Ringee says so under **Needs Ringee**.

## [0.1.0] - Unreleased

First version. Not yet published to npm and not yet verified by n8n.

### Added

- **Ringee API credential** (API key, Base URL, webhook signing secret) with a connection test.
- **Ringee node** with six resources:
  - AI Voice Agent: Get, Get Many, **Start Call** (idempotent, with agent-specific variable fields), Get Call Status, Get Call Result, Get Many Calls.
  - Call: Get, Get Many, Create Dialer Link.
  - Contact: Create, Create or Update, Get, Get Many, Update, Delete.
  - Phone Number: Get, Get Many.
  - Recording: Get, Download (binary).
  - Transcript: Get, Get AI Analysis, Get Summary, Get Extracted Information.
- **Ringee Trigger** for nine events, with signature verification, replay protection, duplicate skipping and filters.
- **AI Agent tool** variant; Delete is not offered to AI agents.
- Twelve workflow templates and a catalog, one built only from HTTP Request nodes.
- Typed API layer with paging, safe retries, rate-limit handling and error messages that say what to do.

### Needs Ringee

The public API additions that ship with this node (`ringee-app`, not yet deployed): `GET /api/v1/ai-voice-agents/:id`, the `Idempotency-Key` header on Start Call, `/api/v1/contacts`, `/api/v1/calls`. See [docs/compatibility.md](docs/compatibility.md).

### Known limits

- No automatic webhook registration ([proposal](docs/webhook-subscriptions-proposal.md)).
- No contact-list, campaign or meeting operations: Ringee has no public API for them ([matrix](docs/api-capability-matrix.md)).
- AI tool `Output` selector and Contact `Simplify` are not implemented yet.
