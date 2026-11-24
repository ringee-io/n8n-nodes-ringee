# Proposal: webhook subscriptions API (automatic trigger registration)

**Status:** proposal for Ringee, not implemented. It is the one gap that keeps the Ringee Trigger from registering itself the way n8n's own triggers do.

## Today

A Ringee **Custom Integration** has one `outboundUrl`, one list of `subscribedEvents` and one signing secret, all edited in the dashboard (`/api/integrations/custom/:id`, authenticated as a signed-in organization admin). The API key (`cik_live_…`) cannot change them.

Consequences for n8n:

- The Ringee Trigger cannot register its URL when a workflow is activated or remove it on deactivation; a person pastes the URL into Ringee once.
- n8n has separate _test_ and _production_ URLs. With one slot, testing means swapping the URL by hand.
- Two workflows that both need events need two integrations (two keys) or one router workflow.
- Deactivating a workflow leaves Ringee posting to a dead URL until someone clears it: Ringee retries ten times, then emails the failure.

## Proposed API

Authenticated with the Custom Integration key, scoped to its workspace like the other `/api/v1` routes.

| Route                         | Purpose                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/webhooks`       | `{ url, events[], description? }` → `201 { id, url, events, signingSecret, status, createdAt }`. The secret (`whsec_…`) is shown once. |
| `GET /api/v1/webhooks`        | List this integration's subscriptions (no secrets).                                                                                    |
| `GET /api/v1/webhooks/:id`    | One subscription.                                                                                                                      |
| `DELETE /api/v1/webhooks/:id` | Remove it. Idempotent.                                                                                                                 |

Rules: `https` URLs only, validated as public (the same `isPrivateHost` check as the Outbound URL); events limited to the outbound event catalogue; a limit per integration (for example 10); creation is idempotent on `(integration, url)`, so a retried activation does not duplicate.

## What it changes inside Ringee

1. **A table**, `CustomIntegrationWebhook`: `id`, `integrationId`, `url`, `events[]`, `signingSecretCt` (encrypted like the integration's), `status`, timestamps. Cascade on integration delete.
2. **Delivery** (`CustomIntegrationOutboundService.enqueue`): besides the integration's own `outboundUrl`, enqueue one delivery per active subscription subscribed to the event, with `webhookId` on the row and the subscription id in the dedupe key.
3. **Signing** (`CustomIntegrationDeliveryService.process`): sign with the subscription's secret when `webhookId` is set, with the integration's otherwise. The legacy single URL keeps working untouched.
4. **A migration** (new table, plus a nullable `webhookId` on the delivery table). Ringee's migrations are applied by hand, so this is a release step, not a code deploy.
5. Dashboard: the delivery log already lists `destinationUrl`; a read-only list of subscriptions is enough at first.
6. Rules and docs in Ringee: a `HOOK-0xx` rule, `INTEGRATIONS.md`, `SECURITY.md`, and tests for secrets never listed, per-integration isolation and the limit.

It is additive: no existing payload, route or enum changes.

## What it changes in this node

```ts
webhookMethods = { default: {
  checkExists: GET /v1/webhooks, find ours by URL → true
  create:      POST /v1/webhooks { url: this.getNodeWebhookUrl('default'), events } → store { id, signingSecret } in the workflow's static data
  delete:      DELETE /v1/webhooks/:id
}}
```

and `webhook()` verifies with the secret from static data (falling back to the credential's, for the manual flow). Test and production URLs register separately, so _Listen for test event_ no longer disturbs a live workflow. The manual flow stays as a fallback for servers without the routes.

## Why it is not in this release

It needs a database migration and a change to the delivery pipeline that sends every customer's webhooks. That is a product change to review, deploy and migrate on its own schedule, not something to fold into an integration package. The manual flow is complete, secure and documented, and the lifecycle methods already refuse to activate a trigger that could only reject events.
