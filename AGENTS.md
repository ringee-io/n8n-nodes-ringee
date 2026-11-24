# AGENTS.md

Rules for AI agents and contributors working on `n8n-nodes-ringee`, the official Ringee community node for n8n. Humans: read [CONTRIBUTING.md](CONTRIBUTING.md) first; this file is the short form.

## Product nature

The node can **place real phone calls that cost real credits and reach real people**. A change is correct only if it keeps: no second paid call, no secret leakage, the workspace isolation Ringee's API enforces, and the ability to run without any Ringee source code.

## Hard rules

- **Public API only.** Talk to Ringee only through `/api/v1`, the click-to-call route and webhooks. Never import Ringee code, never depend on `ringee-app` being present. Do not invent endpoints, events or fields: if it is not in `docs/api-capability-matrix.md`, it does not exist. Add it to the matrix (and to Ringee) first.
- **No runtime dependencies, no `process.env`, no file access, no restricted imports** in `nodes/`, `credentials/`, `lib/` (n8n will not verify the package otherwise). `npm run lint` and `npx @n8n/scan-community-package .` must pass.
- **`eslint.config.mjs` stays the default.** Never edit it. A justified exception is an inline `eslint-disable` with a reason, in a test or script only.
- **Idempotency.** Anything that can place a call goes through `ringeeRequest` with an idempotency key; never add a blind retry to a write (`shouldRetry` in `lib/api/client.ts` is the policy and is tested).
- **Secrets.** The API key and signing secret never appear in logs, errors, outputs, tests, templates or docs. Base URL handling is in `lib/utils/base-url.ts`: `https` only (localhost excepted), no redirects.
- **AI tools.** A destructive operation must stay out of the `@tool` operation list. Billable operations need clear descriptions and rely on Ringee's gates.
- **Tests never place a call.** Use `tests/helpers/mock-ringee.ts`. The real-workspace suite is opt-in and separate.
- **Templates:** fictional numbers only (`+1 415 555 0100`–`0199`), no credentials, sticky notes, an Idempotency Key on every call. Catalog in `workflows/catalog.json`; docs are generated.
- **Commit, push, publish, create the GitHub repository or submit to n8n only when the owner explicitly asks.**

## Layout

```
credentials/RingeeApi.credentials.ts      the credential (+ icons)
nodes/Ringee/                              action node: resources/<resource>/, methods/ (dropdowns), shared/
nodes/RingeeTrigger/                       webhook trigger
lib/{api,types,errors,utils}/              typed client, contracts, messages, helpers (no n8n UI code)
tests/                                     Vitest; helpers/mock-ringee.ts is the executable API contract
workflows/ + catalog.json                  templates; docs/workflow-templates.md is generated from the catalog
docs/                                      matrix, events, idempotency, compatibility, verification, licensing
scripts/                                   package check, template docs, live template validation
.agents/                                   n8n's own authoring guides (kept from the scaffold)
```

## Before you finish

`npm run validate` (lint, types, tests, build, pack check), `npm run docs:templates` if the catalog changed, the README / matrix / changelog updated for any behaviour change.
