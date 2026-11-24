<!-- Generated from catalog.json by scripts/build-template-docs.mjs. Do not edit by hand. -->

# Ringee workflow templates for n8n

Importable n8n workflows that put Ringee AI phone calls to work. Each one is a complete, working starting point with sticky notes that explain how it works, what to configure and what to watch for.

| #   | Template | Needs | For | Status |
| --- | -------- | ----- | --- | ------ |
| 00 | [Make your first AI phone call from n8n with Ringee](00-quick-start-first-ai-call.json) | Ringee | Anyone installing the Ringee node for the first time. | Not published (draft) |
| 01 | [AI appointment reminder calls with Ringee, Google Calendar and n8n](01-ai-appointment-reminder.json) | Ringee, Google Calendar | Sales teams, clinics, agencies and service businesses that book meetings in Google Calendar. | Not published (draft) |
| 02 | [Qualify new leads with an AI phone call from Google Sheets using Ringee](02-automatic-lead-qualification.json) | Ringee, Google Sheets | Agencies and small sales teams that collect leads in Google Sheets. | Not published (draft) |
| 03 | [Follow up on missed meetings with an AI voice call and HubSpot](03-missed-meeting-follow-up.json) | Ringee, HubSpot, A scheduling tool that can send a webhook on a no-show | Sales teams that book demos through a scheduling tool and keep records in HubSpot. | Not published (draft) |
| 04 | [Call Facebook Lead Ads leads in minutes with a Ringee AI voice agent](04-facebook-lead-ads-ai-call.json) | Ringee, Facebook Lead Ads, HubSpot | Marketing teams and agencies running Facebook and Instagram lead ads. | Not published (draft) |
| 05 | [Call every new HubSpot contact with a Ringee AI voice agent and log the call](05-hubspot-lead-calling.json) | Ringee, HubSpot | Teams whose lead intake lands in HubSpot (forms, imports, integrations). | Not published (draft) |
| 06 | [Call back missed calls automatically with a Ringee AI voice agent](06-automated-missed-call-callback.json) | Ringee, Google Sheets | Small businesses, clinics and agencies with unstaffed hours. | Not published (draft) |
| 07 | [Notify your team about every AI receptionist call with a structured summary](07-ai-receptionist.json) | Ringee, Slack | Businesses using the Ringee AI receptionist for incoming calls. | Not published (draft) |
| 08 | [Call new GoHighLevel leads with a Ringee AI voice agent and update the opportunity](08-gohighlevel-lead-automation.json) | Ringee, GoHighLevel | Agencies and teams running their pipeline in GoHighLevel. | Not published (draft) |
| 09 | [Post call summaries and transcripts to Slack automatically with Ringee](09-call-transcripts-to-slack.json) | Ringee, Slack | Sales and support teams that review calls. | Not published (draft) |
| 10 | [AI agent that makes phone calls with Ringee tools in n8n](10-ai-agent-that-makes-phone-calls.json) | Ringee, An LLM provider (OpenAI in the template) | Teams building AI assistants and automation agencies. | Not published (draft) |
| Alt | [AI appointment reminder with plain HTTP Request nodes (no community node needed)](alternatives/01-ai-appointment-reminder-http-request.json) | Ringee (HTTP API), Google Calendar | n8n Cloud users and anyone evaluating Ringee. | Not published (draft) |

Full descriptions, prerequisites, configuration steps and expected results: [docs/workflow-templates.md](../docs/workflow-templates.md).

## Import a template

1. In n8n, open **Workflows → Import from file** (or paste the JSON into the canvas).
2. Open each Ringee node and choose your **Ringee API** credential.
3. Follow the **Setup** sticky note in the template.
4. Use a test number you control for the first run. Every number in these templates is fictional.

The templates need the Ringee community node. On n8n Cloud, where unverified community nodes cannot be installed, start with the [HTTP Request alternative](alternatives/01-ai-appointment-reminder-http-request.json).

## Read this before calling real people

These workflows place real phone calls and spend real credits. Call only people who agreed to be contacted, only at suitable hours, and follow your local rules on recording and automated calls. Ringee blocks numbers on your Do-Not-Call list and stops when credits run out, but permission to call is yours to confirm.

## Verification status

Every template is imported into a real n8n, its nodes are checked against n8n's own node definitions (`npm run validate:templates`), and the Ringee nodes in it are run against a mock of the Ringee API. None has been run end to end against live third-party accounts (Google, HubSpot, Slack, Facebook, GoHighLevel), so check each connected step before relying on it.
