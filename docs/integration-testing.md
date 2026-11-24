# Integration testing against a real Ringee

CI never talks to Ringee. Everything in `npm test` runs against a local mock, so a test can never place a paid call.

When you need to check the node against the real API, do it from your own machine, with **a dedicated Ringee test workspace** and **a spending limit**:

1. Create a separate Ringee organization (or personal workspace) just for tests. Never use a production workspace.
2. Add only a few credits (a few dollars is plenty for a handful of calls) and turn **auto-reload off**, so the balance is the ceiling.
3. Create a Custom Integration and an AI voice agent there. Use a phone number **you control** as the destination.
4. Run:

```bash
RINGEE_TEST_API_KEY=cik_live_… \
RINGEE_TEST_BASE_URL=https://api.ringee.io \
RINGEE_TEST_PHONE=+<a number you own> \
RINGEE_TEST_AGENT_ID=<agent id> \
npm run test:integration
```

Only read operations run unless `RINGEE_TEST_ALLOW_CALLS=1` is set, which places **one** call to `RINGEE_TEST_PHONE`. The suite skips itself when `RINGEE_TEST_API_KEY` is missing, so it is harmless in CI.

Never commit these values, and never point the suite at a number you do not own.
