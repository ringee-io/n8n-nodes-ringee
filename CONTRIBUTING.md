# Contributing

Thanks for helping. This is the official Ringee integration for n8n; it can place real phone calls that cost real money, so changes are held to a high bar for safety, not only for style.

Set up and the everyday commands are in [docs/local-development.md](docs/local-development.md). In short:

```bash
npm install
npm run validate     # lint, types, tests, build, package check: must be green before a pull request
```

## The rules that matter

1. **The node talks to Ringee only through its public API and webhooks.** Never import Ringee source, never reach into its database, never assume a route exists. If something is missing, say so in [docs/api-capability-matrix.md](docs/api-capability-matrix.md) and do not invent it.
2. **No runtime dependencies, no `process.env`, no file access** in node code. n8n will not verify a package that has them. (Tests and scripts are not published and may.)
3. **Never a second paid call.** Anything that can place a call or spend credit goes through the idempotency rules in [docs/idempotency.md](docs/idempotency.md). Do not add an automatic retry to a write.
4. **Secrets never leave the credential.** Not into logs, errors, outputs, tests or templates. The API key is sent only to the Base URL, never via a redirect.
5. **Tests never place a call.** They run against the mock in `tests/helpers/mock-ringee.ts`. The opt-in integration suite ([docs/integration-testing.md](docs/integration-testing.md)) needs a dedicated test workspace and a spending limit.
6. **Do not edit `eslint.config.mjs`.** n8n's strict mode needs the default. Scope a justified exception to one file with a comment that says why.
7. **Compatibility is a contract.** Output fields and parameter names are used by saved workflows. Additions are safe; a rename or removal needs a new node `version` ([docs/compatibility.md](docs/compatibility.md)).

## Adding or changing an operation

- [ ] The Ringee route exists (or is added in `ringee-app` first, additively). Check [the matrix](docs/api-capability-matrix.md).
- [ ] Types in `lib/types/`; the call in the resource module under `nodes/Ringee/resources/<resource>/`.
- [ ] UX per [n8n's guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines/): Title Case names, sentence-case actions, `Return All` / `Limit`, a resource locator where an id is needed, `Whether…` for booleans. `tests/descriptions.test.ts` enforces most of it.
- [ ] Errors go through `lib/errors` so they say what to do; no secrets in them.
- [ ] A destructive operation is hidden from the AI tool variant (see how `contact` does it with `@tool`) and asks for a confirmation.
- [ ] The mock server answers the new route; tests cover success, a refusal, several items and `continueOnFail`.
- [ ] README table, the matrix and `CHANGELOG.md` are updated.

## Templates

Edit the JSON in `workflows/` and the matching entry in `workflows/catalog.json`, then `npm run docs:templates`. Every template needs sticky notes (how it works, setup, consent), only fictional numbers (`+1 415 555 0100`–`0199`), an Idempotency Key on every call it places, and no credentials. `npm test` checks all of that; `npm run validate:templates` checks the third-party nodes against a real n8n ([how](docs/local-development.md#validating-templates-against-n8ns-real-node-definitions)).

## Commits and pull requests

Small, focused pull requests with a description of what changed and how you checked it. Describe changes that touch billing, calling or webhooks with extra care. Maintainers squash-merge.

## Releasing

Only maintainers publish. Publishing is done by GitHub Actions with an npm provenance statement; do not publish from a laptop (n8n will not verify such a package).

One-time setup:

1. Create the public repository **`ringee-io/n8n-nodes-ringee`** and push this code.
2. Publish the first version, then on npmjs.com open the package → **Settings → Trusted Publisher → GitHub Actions** and enter owner `ringee-io`, repository `n8n-nodes-ringee`, workflow `publish.yml`. (The first publish can be run from Actions with a granular `NPM_TOKEN` secret; remove the secret afterwards.)

Each release:

1. Deploy any Ringee API change the release needs; note it under _Needs Ringee_ in the changelog.
2. `npm run validate`, then `npx @n8n/scan-community-package .`.
3. `npm run release`: bumps the version, updates the changelog, commits, tags and pushes. The tag starts `publish.yml`, which lints, builds and publishes with provenance.
4. Run `npx @n8n/scan-community-package n8n-nodes-ringee` against the published package.
5. Verification submissions go through the [Creator Portal](https://creators.n8n.io/nodes); see [the checklist](docs/n8n-verification-checklist.md).
