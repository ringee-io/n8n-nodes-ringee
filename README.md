<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://www.ringee.io/logos/white.logo.png">
    <img alt="Ringee" src="https://www.ringee.io/logos/black.logo.png" width="220">
  </picture>
</p>

# n8n-nodes-ringee

**Give your n8n workflows the power to make phone calls.**

Ringee community node for [n8n](https://n8n.io): start AI voice agent calls, read results, transcripts and recordings, manage contacts, and react to call events. Built for AI appointment reminders, lead qualification, missed-call callbacks, AI receptionists, and AI agents that pick up the phone.

> **Status.** This is a community node. It has **not been verified by n8n yet**, so it is not available on n8n Cloud. Install it on self-hosted n8n through _Settings → Community nodes_ (see [Installation](#installation)), or use the [HTTP Request alternative](workflows/alternatives/01-ai-appointment-reminder-http-request.json) on n8n Cloud. The verification work is tracked in [docs/n8n-verification-checklist.md](docs/n8n-verification-checklist.md).

[Quick start](#make-your-first-ai-phone-call-in-under-5-minutes) ·
[Installation](#installation) ·
[Credentials](#credentials) ·
[Operations](#operations) ·
[Ringee Trigger](#ringee-trigger) ·
[AI Agent tools](#use-ringee-as-a-tool-in-an-n8n-ai-agent) ·
[Templates](#workflow-templates) ·
[Compatibility](#compatibility) ·
[Troubleshooting](#troubleshooting)

---

## Make your first AI phone call in under 5 minutes

1. **Create the key.** In Ringee open **Integrations → Custom Integrations**, create an integration and copy its **API key** (`cik_live_…`) and **Signing Secret** (`whsec_…`).
2. **Install the node.** In n8n: **Settings → Community nodes → Install**, enter `n8n-nodes-ringee`.
3. **Add the credential.** Create a **Ringee API** credential, paste the API key (and the signing secret if you will use the trigger) and click **Test**.
4. **Import the quick start.** Import [`workflows/00-quick-start-first-ai-call.json`](workflows/00-quick-start-first-ai-call.json).
5. **Pick your agent and your number.** In _Start AI call_ choose your AI voice agent from the list and replace the sample phone number with **your own**.
6. **Execute.** Your phone rings. Two minutes later the last node shows how the call went.

Or build it by hand: add the **Ringee** node → **AI Voice Agent → Start Call** → choose an agent → enter a number → execute. Start Call returns immediately with the call ID; the call itself finishes later.

> **Real calls cost real credits and reach real people.** Call only people who agreed to be called, only at suitable hours, and follow your local rules on automated calls and recording. Ringee refuses numbers on your Do-Not-Call list and stops when credits run out; permission to call is yours to confirm.

## Installation

### Through the n8n interface (self-hosted)

**Settings → Community nodes → Install**, enter `n8n-nodes-ringee`, accept the risk notice and install. See n8n's [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

### Manually, on a self-hosted n8n

```bash
cd ~/.n8n/nodes          # create it if it does not exist
npm install n8n-nodes-ringee
# restart n8n
```

For Docker, install it into the `nodes` folder of the volume mounted at `/home/node/.n8n`, or build an image that runs the `npm install` above.

### Using the node as an AI Agent tool

On self-hosted n8n, community nodes are only offered as tools when this is set on the n8n process:

```bash
N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true
```

### n8n Cloud

Cloud installs only [verified](docs/n8n-verification-checklist.md) community nodes. Until Ringee is verified, use the [HTTP Request alternative](workflows/alternatives/01-ai-appointment-reminder-http-request.json) with a Header Auth credential.

## Credentials

Create a **Ringee API** credential:

| Field                      | What to enter                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **API Key**                | The `cik_live_…` key of a Ringee **Custom Integration** (Integrations → Custom Integrations). It is shown once; copy it when created. |
| **Base URL**               | `https://api.ringee.io` for Ringee Cloud (the default). For a self-hosted Ringee, your API address, without `/api`.                   |
| **Webhook Signing Secret** | The integration's `whsec_…` secret. Only the **Ringee Trigger** needs it.                                                             |

Click **Test**: n8n reads one page of contacts with the key. A rejected key says so; a valid key in a workspace without AI voice agents still passes (contacts and calls do not need them).

How the key works:

- **The key belongs to a workspace.** Ringee derives the organization and the user from the key, so there is no workspace or user field and a request can never name another one.
- **Rotate it in Ringee.** A regenerated key stops working at once; update the credential.
- **It only travels to the Base URL.** The node requires `https` (plain `http` only for `localhost`), refuses addresses with embedded passwords, and **never follows redirects**, so a misconfigured or hostile address cannot receive the key.
- **It is never logged or returned** in node output or error messages.

## Operations

All resources use the standard **Resource → Operation** selectors. Lists have **Return All** and **Limit**; items stay linked to their inputs, and **Continue On Fail** keeps one failed item from stopping the rest.

| Resource           | Operations                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| **AI Voice Agent** | Get · Get Many · **Start Call** · Cancel Call · Get Call Status · Get Call Result · Get Many Calls |
| **Call**           | Get · Get Many · Create Dialer Link (a link a person opens to place a human call)                  |
| **Contact**        | Create · Create or Update · Get · Get Many · Update · Delete                                       |
| **Phone Number**   | Get · Get Many (the numbers an AI voice agent can call from)                                       |
| **Recording**      | Get · Download (as binary audio)                                                                   |
| **Transcript**     | Get · Get AI Analysis · Get Summary · Get Extracted Information                                    |

Agents, caller numbers and contacts are picked from searchable lists (or by ID). The variables an agent accepts, such as first name or what the call is about, appear as fields once you choose the agent.

### Start Call

`AI Voice Agent → Start Call` returns at once with the call ID, so a workflow never blocks on a phone call:

```json
{
	"call_id": "5a6bb1fc-00ea-4996-8fe4-0a221d047162",
	"status": "initiating",
	"finished": false,
	"queued": false,
	"idempotent_replayed": false
}
```

Ringee paces the calls it starts. When a call has to wait for capacity it is **accepted, not dialed**: `status` is `queued`, `queued` is `true`, and `expires_at` says when it gives up. A queued call that is never dialed costs nothing and sends no event; **Cancel Call** withdraws it. Large batches, a full queue and what to do about each: [docs/queue-and-capacity.md](docs/queue-and-capacity.md).

| Option              | What it does                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Caller Number**   | The number the person sees. Empty = the one assigned to the agent.                                                                                                             |
| **External ID**     | Your own ID for this call (a CRM record, a calendar event). Ringee returns it as `externalId` on **every event** about the call, so a trigger workflow finds the record again. |
| **Idempotency Key** | Makes the request safe to repeat: one call per key. Empty = the node uses a key unique to this execution and item. See [Never a second paid call](#never-a-second-paid-call).  |
| **Metadata (JSON)** | Extra data stored with the call and returned in its result.                                                                                                                    |

Ringee decides what is allowed: no credits, a number on the Do-Not-Call list, an unusable caller ID or an unavailable agent all refuse the call with a message that says what to do. Nothing is dialed.

### Reading the result

A call takes a minute or two and its analysis a little longer, so there are two ways to get the result:

- **React to the event** with the [Ringee Trigger](#ringee-trigger) (`Call Completed`), then, after a short **Wait**, read the AI's result with **Get Call Result**. Most templates do this. Ringee publishes agent-specific results such as `confirmed` or `cannot_attend` only through the result endpoint, not as events. [Why and how](docs/events-and-results.md).
- **Poll** with **Get Call Status** (`finished: true/false`, `queued: true/false`) or **Get Call Result** inside a bounded loop. Use explicit timeouts; the [quick start](workflows/00-quick-start-first-ai-call.json) shows a single wait-then-read.

### Never a second paid call

Retries must not dial twice. Three things protect you:

1. **Idempotency Key.** Start Call sends an `Idempotency-Key`. Ringee places the call once and answers any repeat with the original call (`idempotent_replayed: true`). Set your own key to protect across executions, for example `reminder-{{ $json.eventId }}`.
2. **Automatic keys.** If you set none, the node builds one from the workflow, execution, node, run and item. n8n's **Retry On Fail**, a timed-out request and a resumed execution repeat the _same_ attempt, so they cannot place a second call; a new item or a new loop iteration is a new attempt and does.
3. **No blind retries.** The node repeats only requests that are safe: reads on temporary gateway answers, and any request Ringee rejected as rate-limited before running it. A write that may have been processed is never resent by the node itself.

Details and limits: [docs/idempotency.md](docs/idempotency.md).

## Ringee Trigger

Starts a workflow when something happens in Ringee. It is a signed webhook receiver:

- **Verifies every delivery** with `HMAC-SHA256(secret, "<timestamp>.<raw body>")` over the exact bytes received, in constant time. An unsigned, forged, tampered or stale (older than 5 minutes by default) request is refused with `401` and starts nothing.
- **Ignores repeats.** Ringee sends an event again if it did not get an answer in time; the trigger skips an event ID it has already run.
- **Filters** by event, by AI voice agent, by "only AI agent calls" and by External ID prefix (each Custom Integration has one Outbound URL, so use one integration per workflow and this prefix to keep each workflow to its own calls).
- Works with **test and production URLs**. Ringee's **Send test** button shows a sample while you build.

| Event                         | Fires when                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| **Call Completed**            | A call ended, human or AI. The AI analysis may still be on its way.                      |
| **Call Outcome Updated**      | An outcome was recorded (including an AI agent's `meeting_booked`, `not_interested`, …). |
| **Call Failed**               | A call could not be connected.                                                           |
| **Call Missed**               | An inbound call was not answered.                                                        |
| **Recording Ready**           | A recording was processed. Carries the transcript when it exists.                        |
| **Meeting Created**           | A meeting was booked, by a person or an AI voice agent.                                  |
| **Callback Created**          | A callback was scheduled.                                                                |
| **Note Created**              | A note was added to a contact.                                                           |
| **Do-Not-Call Entry Created** | A number was added to the Do-Not-Call list.                                              |

**Set it up once:** in Ringee open the Custom Integration, paste the trigger's **Production URL** as the **Outbound URL**, tick the events, and put the **Signing Secret** in the credential. Activating a workflow whose credential has no signing secret fails with a message that says so, instead of silently rejecting events later.

> Ringee has one Outbound URL per Custom Integration and no webhook-registration API, so the trigger cannot register itself; it validates the setup on activation instead. Use one integration per trigger workflow, or one trigger with a router. The proposal for automatic registration is in [docs/webhook-subscriptions-proposal.md](docs/webhook-subscriptions-proposal.md).

Events not offered here (call started, answered, voicemail, transcript ready, campaign completed, contact created, meeting rescheduled or cancelled) **do not exist in Ringee today**; see the [capability matrix](docs/api-capability-matrix.md) for what each need maps to.

## Use Ringee as a tool in an n8n AI Agent

The node is available to n8n's **AI Agent** as **Ringee Tool** (set `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` on self-hosted n8n). Add one tool per capability and let the model fill the fields:

- _Contact → Get Many_: "Find Ada Lovelace."
- _AI Voice Agent → Start Call_: "Call this customer to confirm tomorrow's meeting."
- _AI Voice Agent → Get Call Result_ and _Transcript → Get_: "Retrieve the transcript and summarize the objections."

Safety by design:

- **Delete is never offered to an AI agent.** The tool's Contact operations leave it out; only a person building a normal workflow can pick it, and it needs the contact's phone number as confirmation.
- **Start Call is billable.** Tell the agent to ask for your yes before every call (the [template](workflows/10-ai-agent-that-makes-phone-calls.json) does) and add n8n's human-approval step in front of the tool for production. Ringee still enforces credits, Do-Not-Call and calling limits on every call.
- Each tool is a separate node, so the model can only do what you wired in.

See [docs/ai-agent-tools.md](docs/ai-agent-tools.md) and [template 10](workflows/10-ai-agent-that-makes-phone-calls.json).

## Workflow templates

Twelve importable workflows in [`workflows/`](workflows/), documented in [docs/workflow-templates.md](docs/workflow-templates.md):

| #   | Template                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| 00  | [Make your first AI phone call](workflows/00-quick-start-first-ai-call.json)                                              |
| 01  | [AI appointment reminder](workflows/01-ai-appointment-reminder.json) (Google Calendar)                                    |
| 02  | [Automatic lead qualification](workflows/02-automatic-lead-qualification.json) (Google Sheets)                            |
| 03  | [Missed meeting follow-up](workflows/03-missed-meeting-follow-up.json) (HubSpot)                                          |
| 04  | [Facebook Lead Ads → AI call](workflows/04-facebook-lead-ads-ai-call.json)                                                |
| 05  | [HubSpot lead calling](workflows/05-hubspot-lead-calling.json)                                                            |
| 06  | [Automated missed-call callback](workflows/06-automated-missed-call-callback.json)                                        |
| 07  | [AI receptionist → team notification](workflows/07-ai-receptionist.json) (Slack)                                          |
| 08  | [GoHighLevel lead automation](workflows/08-gohighlevel-lead-automation.json)                                              |
| 09  | [Call transcripts to Slack](workflows/09-call-transcripts-to-slack.json)                                                  |
| 10  | [AI Agent that makes phone calls](workflows/10-ai-agent-that-makes-phone-calls.json)                                      |
| Alt | [Appointment reminder with plain HTTP Request nodes](workflows/alternatives/01-ai-appointment-reminder-http-request.json) |

Every number in them is fictional. They were imported into a real n8n, validated against n8n's node definitions and run against a mock Ringee API; **none has been run with live Google, HubSpot, Slack, Facebook or GoHighLevel accounts**, so check each connected step.

## Compatibility

- **n8n:** developed and tested on n8n 2.x (community-node API version 1). Using the node as an AI tool needs a version that supports `usableAsTool`.
- **Ringee Cloud:** `https://api.ringee.io` (the default).
- **Self-hosted Ringee:** set the Base URL. Each operation needs a Ringee that has the public API behind it; the node says so in plain words when a route is missing. The operations by Ringee capability are in [docs/compatibility.md](docs/compatibility.md).

## Troubleshooting

| You see                                                     | Why, and what to do                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| _Ringee did not accept the API key_                         | The key was regenerated, mistyped, or its Custom Integration is disabled. Copy the current key into the credential.            |
| _Your Ringee workspace has no credits left_                 | Add credits in Ringee. Nothing was dialed.                                                                                     |
| _That number is on your Do-Not-Call list_                   | Ringee did not call. Remove the number from the list only if the person agreed to be called.                                   |
| _AI voice agents are not enabled for this Ringee workspace_ | The key belongs to a workspace without AI voice agents. Use a key from one that has them.                                      |
| _This Ringee server does not offer that operation yet_      | A self-hosted Ringee older than this node expects. Update it, or use Ringee Cloud. See [compatibility](docs/compatibility.md). |
| _Ringee answered with a redirect_                           | The Base URL is not the exact API address. The node never follows redirects, on purpose.                                       |
| _Could not reach Ringee_                                    | Network or Base URL. Plain `http://` is accepted only for `localhost`; any other address must be `https://`.                   |
| Activation fails: _no Webhook Signing Secret_               | Paste the integration's `whsec_…` into the credential.                                                                         |
| The trigger never starts                                    | Paste the **Production** URL (not the test URL) into the integration's Outbound URL, tick the event there too, and use HTTPS.  |
| The trigger answers 401                                     | The signing secret does not match that integration, or the request is older than the allowed age (check the server clock).     |
| `outcome` is null on a result                               | The AI analysis takes a minute or two after the call. Wait, then read again; the templates do this for you.                    |
| Calls repeat in a loop                                      | Give Start Call an **Idempotency Key** that names the thing being called (a record ID), so a repeat is recognized.             |
| Rate limited (429)                                          | The node waits as Ringee asks and retries twice. For long lists, add a **Wait** between batches.                               |

## Local development

```bash
npm install
npm run dev          # n8n with the node loaded and hot reload
npm test             # unit + mock-API tests, no network, never a real call
npm run validate     # lint, types, tests, build, package check
```

Running it locally, the mock Ringee API and validating templates against a real n8n are covered in [docs/local-development.md](docs/local-development.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately: [SECURITY.md](SECURITY.md).

## Resources

- [Ringee](https://ringee.io) · [Ringee documentation](https://docs.ringee.io)
- [API capability matrix](docs/api-capability-matrix.md) · [Events and results](docs/events-and-results.md) · [Idempotency](docs/idempotency.md)
- [n8n community nodes](https://docs.n8n.io/integrations/#community-nodes)

## Version history

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © Ringee. The Ringee name and logo are trademarks of Ringee and are not licensed by the MIT license; see [docs/licensing.md](docs/licensing.md).
