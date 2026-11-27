# Security policy

This package handles Ringee API keys, signs-and-verifies webhooks, and can start phone calls that cost money. We take reports seriously.

## Report a vulnerability

**Do not open a public issue.** Email **hello@ringee.io** with the subject "n8n-nodes-ringee security", or use GitHub's **Report a vulnerability** (private advisories) on this repository. Include what you found, how to reproduce it, and the version. You will get an acknowledgement within three working days.

Please give us a reasonable time to fix a problem before disclosing it.

## What counts

For example: the API key leaking into logs, errors, output or a request to another host; accepting a webhook that is unsigned, forged, tampered or replayed; a way to make the node place a call, spend credit or delete data it should not; an AI tool path to a destructive operation; one workspace reaching another's data; a dependency or build step that could run untrusted code.

Vulnerabilities in **Ringee itself** (the platform) go to the same address; vulnerabilities in **n8n** go to n8n.

## Supported versions

The latest published version receives fixes. While the package is below 1.0, only the latest minor is supported.

## How the package protects you

- The API key is sent only to the credential's Base URL (`https`, or `http` for localhost), never followed through a redirect, and never logged or returned.
- Webhook deliveries are verified (`HMAC-SHA256`, constant-time, over the raw body, with a timestamp window) before anything is read; repeated event ids are skipped. See [docs/events-and-results.md](docs/events-and-results.md).
- Start Call is idempotent ([docs/idempotency.md](docs/idempotency.md)); writes are never retried blindly.
- Delete is never offered to AI agents and always needs the contact's phone number as confirmation.
- No runtime dependencies, so no transitive supply chain; releases are built and published by GitHub Actions with an npm provenance statement.
- Recordings and transcripts are sensitive: the node returns them only to the workflow that asks and never stores them.
