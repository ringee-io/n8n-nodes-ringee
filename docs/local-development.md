# Local development

Everything runs on your machine, needs no Ringee account, and **never places a real call**.

```bash
git clone https://github.com/ringee-io/n8n-nodes-ringee && cd n8n-nodes-ringee
npm install
npm run validate        # lint, types, tests, build, package check
```

## Commands

| Command                             | What it does                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                       | Starts n8n on http://localhost:5678 with the node linked and hot reload (`n8n-node dev`).                                                                  |
| `npm run build`                     | Compiles to `dist/` and copies icons and codex files.                                                                                                      |
| `npm run lint` / `lint:fix`         | n8n's official ruleset. **Do not edit `eslint.config.mjs`:** strict mode requires the default.                                                             |
| `npm run typecheck`                 | Types for the node, tests and scripts.                                                                                                                     |
| `npm test`                          | Unit and mock-API tests (Vitest). Offline.                                                                                                                 |
| `npm run pack:check`                | Checks `npm pack`: complete, no secrets, no tests. `node scripts/check-package.mjs --install` also installs the tarball into an empty folder and loads it. |
| `npm run docs:templates`            | Regenerates `workflows/README.md` and `docs/workflow-templates.md` from `workflows/catalog.json`.                                                          |
| `npm run validate:templates`        | Validates templates against a real n8n's node definitions (below).                                                                                         |
| `npx @n8n/scan-community-package .` | n8n's own verification scan, locally, after `npm run build`.                                                                                               |

## A mock Ringee API

[`tests/helpers/mock-ringee.ts`](../tests/helpers/mock-ringee.ts) is a real HTTP server with the routes the node uses: API key check, idempotent replay, paging, validation errors, a Do-Not-Call number (`+14155550199`), rate limiting, redirects, a lost response and a recording download. The tests use it; you can run it by hand:

```bash
node tests/helpers/serve-mock.ts        # http://127.0.0.1:4010, API key cik_live_ + 64 × "a"
DROP_FIRST_START=1 node tests/helpers/serve-mock.ts   # lose the first Start Call's response after it is placed
```

Set the credential's Base URL to `http://127.0.0.1:4010` (plain `http` is accepted for localhost) and the key to the one above. It prints every request, including the `Idempotency-Key`.

## Trying the node in a real n8n like a user would

`npm run dev` links the node as a development extension (its type is `CUSTOM.ringee`). To test exactly what users install:

```bash
npm run build && npm pack                      # creates n8n-nodes-ringee-<version>.tgz
mkdir -p ~/n8n-test/.n8n/nodes && cd ~/n8n-test/.n8n/nodes
npm init -y && npm install /path/to/n8n-nodes-ringee-<version>.tgz
N8N_USER_FOLDER=~/n8n-test N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true npx n8n start
```

The nodes are then `n8n-nodes-ringee.ringee`, `…ringeeTrigger` and the generated `…ringeeTool`, the names the templates use.

### Send the trigger a signed event

```bash
node examples/send-test-event.mjs <trigger production or test URL> whsec_<your secret> examples/events/call.completed.json
```

It signs the file the way Ringee does and posts it. Add `--tamper` to see the trigger refuse it.

## Validating templates against n8n's real node definitions

CI cannot (n8n's node definitions are not part of this repository), so do it locally when you add or change a template:

```bash
# n8n running locally and logged in; save its node catalog
curl -s --compressed -b cookies.txt http://localhost:5678/types/nodes.json -o nodes.json
node scripts/validate-workflows.mjs nodes.json workflows/*.json workflows/alternatives/*.json
```

It reports an unknown node or version, a parameter that does not exist or is not shown for the chosen options, and a required parameter left empty. Then import the file into n8n to see it on the canvas.
