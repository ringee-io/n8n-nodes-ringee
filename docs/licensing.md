# Licensing

## What this package is licensed under

**MIT** (see [`LICENSE`](../LICENSE)), © Ringee.

## Why MIT

| Question                             | Answer                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does n8n require?               | Verified community nodes must be MIT-licensed (n8n's verification guidelines: "Make sure your package license is MIT"). Any other license rules out n8n Cloud.                                                                                                                                |
| What is Ringee's own license?        | The Ringee platform (`ringee-app`) is **AGPL-3.0**. Its published client SDK (`@ringee/dialer-sdk`) is **MIT**; the agent package and CLI are AGPL-3.0-or-later.                                                                                                                              |
| Does the node contain AGPL code?     | **No.** It is new code written for this repository. It does not import, copy or link any Ringee source: it calls a network API and receives webhooks. Types and test fixtures were written from the API's behaviour, not copied. A client of a network API is not a derivative of the server. |
| Is anything reused from Ringee?      | The **Ringee mark** (the globe), as the node icon. It is Ringee's own artwork, used here with Ringee's intent. See the trademark note below.                                                                                                                                                  |
| Is anything reused from n8n?         | Only through the peer dependency `n8n-workflow` (the scaffold, linter and CI files come from n8n's `@n8n/node-cli` template, MIT). n8n's own node definitions are **not** copied here.                                                                                                        |
| Was existing Ringee code relicensed? | No. AGPL code stays AGPL. This repository contains none of it.                                                                                                                                                                                                                                |

## Decision needed before publishing

The licensing decision belongs to Ringee, not to the tooling that prepared this repository:

- [ ] Ringee confirms the node is published **MIT** (required for n8n verification).
- [ ] Ringee confirms the **trademark note** below.
- [ ] Ringee confirms the **copyright holder** line ("Ringee") is the right legal name.

Until then nothing should be published to npm.

## Trademarks

"Ringee" and the Ringee logo are trademarks of Ringee. The MIT license covers the code; it does **not** grant the right to use the name or logo to suggest endorsement. Forks that change the behaviour should not present themselves as the official Ringee integration.

## Third-party code

Run-time: none (no dependencies). Development only: `@n8n/node-cli`, TypeScript, ESLint, Prettier, Vitest, release-it, `n8n-workflow` (peer), all permissively licensed or n8n's own tooling used as intended.
