# n8n verification checklist

Where this package stands against n8n's requirements for a **verified** community node (the route to n8n Cloud). Sources: n8n's [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/), [submission guide](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes/) and [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines/), read on 2026-11-24 (the pages disagree in places; the stricter reading is followed).

**This package is not verified.** Nothing here is a claim of approval: n8n reviews submissions (up to four weeks) and may reject them. The status column says what is done and shown, and what is not.

Status: ✅ done and evidenced · 🟡 partly · ⏳ needs an action outside this repository · ❌ not met.

## Package and metadata

| Requirement                                                     | Status | Evidence / what remains                                                                   |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| Name starts with `n8n-nodes-`                                   | ✅     | `n8n-nodes-ringee` (`package.json`, checked by `scripts/check-package.mjs`)               |
| Keyword `n8n-community-node-package`                            | ✅     | `package.json` keywords                                                                   |
| Nodes and credentials listed in `package.json` → `n8n`          | ✅     | `n8n.nodes` (2), `n8n.credentials` (1); the pack check proves each path is in the tarball |
| `@n8n/node-cli` ≥ 0.23.0 as a dev dependency                    | ✅     | `^0.58.5`                                                                                 |
| One third-party service per package                             | ✅     | Ringee only                                                                               |
| Not a logic / flow-control node; not a copy of an existing node | ✅     | A service integration                                                                     |
| Does not compete with n8n's paid features                       | ✅     | Telephony; n8n has no phone-call node                                                     |
| English only (UI, errors, docs)                                 | ✅     | Reviewed                                                                                  |

## Code requirements

| Requirement                                                                                              | Status | Evidence / what remains                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript, strict                                                                                       | ✅     | `tsconfig.json` (`strict: true`); `npm run typecheck`                                                                                                                                             |
| **No runtime dependencies**                                                                              | ✅     | No `dependencies`; the only peer is `n8n-workflow`. Enforced by `npm run pack:check`                                                                                                              |
| No environment variables, no file reads or writes in node code                                           | ✅     | None in `nodes/`, `credentials/`, `lib/`. Binary audio goes through `helpers.prepareBinaryData`. Test and script files use them but are not published                                             |
| No restricted imports or globals                                                                         | ✅     | `npx @n8n/scan-community-package .` passes (also the `crypto` import used to verify signatures)                                                                                                   |
| Official linter passes with the **default** config (strict mode)                                         | ✅     | `npm run lint`: 0 errors, 0 warnings. `eslint.config.mjs` is the unmodified default                                                                                                               |
| `npx @n8n/scan-community-package` passes                                                                 | 🟡     | Passes locally on the built package ("passed the security checks that run before publishing"). The provenance and attested-source checks run after publishing: ⏳ re-run on the published package |
| Error handling uses `NodeApiError` / `NodeOperationError`; item linking (`pairedItem`); `continueOnFail` | ✅     | `tests/ringee-node.test.ts` (multi-item linking, partial failure, item index in errors)                                                                                                           |
| Credentials: secrets are password fields, `authenticate` and `test` defined                              | ✅     | `credentials/RingeeApi.credentials.ts`; connection test run in real n8n (valid, wrong key, wrong URL, unreachable)                                                                                |
| No secrets in logs, output or the package                                                                | ✅     | Tests assert the API key never appears in errors; the pack check scans published files                                                                                                            |
| SSRF and redirect leakage                                                                                | ✅     | Base URL must be `https` (`http` only for localhost), no embedded credentials, redirects never followed (tested)                                                                                  |

## UX guidelines

| Requirement                                                                                                     | Status | Evidence / what remains                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource / Operation pattern; Title Case names, sentence-case actions                                           | ✅     | `tests/descriptions.test.ts` enforces it                                                                                                                                                                                  |
| CRUD where the API allows; standard names (Get Many, Create or Update…)                                         | ✅     | Contact has the full set; others expose what Ringee's API has                                                                                                                                                             |
| Return All and Limit on every Get Many                                                                          | ✅     | Tested                                                                                                                                                                                                                    |
| Resource locators, default _From list_                                                                          | ✅     | Agent, caller number, contact, phone number                                                                                                                                                                               |
| `Simplify` when more than 10 fields                                                                             | 🟡     | Call → Get has it (on by default). Contact has 16 fields and no Simplify; planned for 0.2.0                                                                                                                               |
| AI tool nodes: an **Output** option (Simplified / Raw / Selected fields) for endpoints with more than 10 fields | ❌     | Not implemented. Planned for 0.2.0 (Contact Get/Get Many, Call Get). Likely review feedback                                                                                                                               |
| Delete returns `{ "deleted": true }`                                                                            | 🟡     | Returns `{ deleted: true, id }`, a superset                                                                                                                                                                               |
| Placeholders start with "e.g."; booleans start with "Whether"                                                   | ✅     | Reviewed; the linter checks the booleans                                                                                                                                                                                  |
| Error messages say what happened and how to fix it; avoid "error", "problem", "failure", "mistake"              | ✅     | `tests/utils.test.ts` asserts the wording of every message the node authors                                                                                                                                               |
| Icons: light and dark SVG                                                                                       | ✅     | Ringee's own mark, `nodes/Ringee/ringee.svg` and `ringee.dark.svg`; the linter validates contrast                                                                                                                         |
| Trigger node is programmatic                                                                                    | ✅     | `RingeeTrigger.node.ts`                                                                                                                                                                                                   |
| Webhook trigger lifecycle (`checkExists` / `create` / `delete`)                                                 | 🟡     | Implemented to validate the setup on activation; **Ringee has no registration API, so nothing is registered or removed**. A reviewer may ask for real registration: see [the proposal](webhook-subscriptions-proposal.md) |

## Documentation

| Requirement                                                        | Status | Evidence / what remains                                                                                                       |
| ------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| README with usage, authentication and example workflows            | ✅     | `README.md`, `workflows/`, `docs/`                                                                                            |
| Public repository whose URL matches `repository` in `package.json` | ⏳     | `https://github.com/ringee-io/n8n-nodes-ringee` does not exist yet: create it ([release steps](../CONTRIBUTING.md#releasing)) |
| Same author / maintainer on npm and in the repository              | ⏳     | Publish under the `ringee-io` GitHub organization and a matching npm maintainer                                               |

## Publishing

| Requirement                                                                                                                             | Status | Evidence / what remains                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Published **from GitHub Actions with a provenance statement** (required since 1 May 2026; local publishes are refused for verification) | ⏳     | `.github/workflows/publish.yml` does it on a version tag. Needs the repository and an npm Trusted Publisher (below)                                                                                                                              |
| npm Trusted Publisher configured                                                                                                        | ⏳     | npmjs.com → package → Settings → Trusted Publisher: owner `ringee-io`, repository `n8n-nodes-ringee`, workflow `publish.yml`. The package must exist first (publish `0.1.0` once with a granular token, or let the first workflow run create it) |
| License MIT                                                                                                                             | ✅/⏳  | `LICENSE` is MIT. Ringee's own decision is recorded in [licensing.md](licensing.md): ⏳ confirm before publishing                                                                                                                                |
| Submit at the [Creator Portal](https://creators.n8n.io/nodes)                                                                           | ⏳     | After the package is published with provenance                                                                                                                                                                                                   |

## Remaining blockers, in order

1. Create the public repository `ringee-io/n8n-nodes-ringee` and push this code.
2. Confirm the MIT license and the trademark note with Ringee ([licensing.md](licensing.md)).
3. Deploy the Ringee API changes the node needs (contacts, calls, idempotency, get agent): [compatibility](compatibility.md).
4. Publish `0.1.0` from GitHub Actions with provenance; add the Trusted Publisher.
5. Run `npx @n8n/scan-community-package n8n-nodes-ringee` on the published package.
6. Implement the **Output** option and **Simplify** on Contact (0.2.0) before submitting, to meet the UX guideline for AI tool nodes.
7. Decide whether to build real webhook registration first ([proposal](webhook-subscriptions-proposal.md)).
8. Submit in the Creator Portal and respond to review.
