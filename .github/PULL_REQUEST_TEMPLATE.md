## What and why

## How it was checked

- [ ] `npm run validate` is green
- [ ] Tests added or updated (against the mock; no real calls)
- [ ] No secret, personal number or real recording in code, tests, templates or screenshots
- [ ] A write cannot place a second call (idempotency / no blind retry), or this change does not touch writes
- [ ] README, `docs/api-capability-matrix.md` and `CHANGELOG.md` updated if behaviour changed
- [ ] A new Ringee route or event this depends on already exists, or is linked here
