<!-- Generated from workflows/catalog.json by scripts/build-template-docs.mjs. Do not edit by hand. -->

# Workflow templates

Ready-made n8n workflows for Ringee. Import them from [`workflows/`](../workflows/). Read [Reading results: events and polling](events-and-results.md) first: it explains why most templates wait for the AI analysis before reading a call's result.

Every phone number in these templates is fictional. These workflows place real calls: use your own test number first, and only call people who agreed to be called.

---

## Template 00: Make your first AI phone call from n8n with Ringee

Places one AI voice call from a button click, waits two minutes and reads the result. The fastest way to see Ringee working in n8n.

- **File:** [`workflows/00-quick-start-first-ai-call.json`](../workflows/00-quick-start-first-ai-call.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/00-quick-start-first-ai-call.json))
- **Business use case:** Prove the integration end to end before building anything: credentials, agent, call, result.
- **Who it is for:** Anyone installing the Ringee node for the first time.
- **Needs:** Ringee
- **Ringee features:** AI Voice Agent: Start Call; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A phone number you control, for the test call.

**Configuration**

1. Open the two Ringee nodes and select your Ringee API credential.
2. In Start AI call, pick your agent and replace the sample number with your own.
3. Click Execute workflow and answer the call.

**Sample data:** Sample number +14155550123 (fictional). Variables: first_name = Alex, notification = a quick test.

**Error handling:** A refused call (no credits, Do-Not-Call number, invalid number) stops the run with an explanation; nothing is dialed.

**Expected result:** Your phone rings. Two minutes later the last node shows status, outcome and the AI summary.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 01: AI appointment reminder calls with Ringee, Google Calendar and n8n

An AI voice agent phones each person about an hour before a meeting to confirm they will attend, then the meeting is colour-coded in Google Calendar: green for confirmed, red for cannot attend, yellow for a person to follow up.

- **File:** [`workflows/01-ai-appointment-reminder.json`](../workflows/01-ai-appointment-reminder.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/01-ai-appointment-reminder.json))
- **Business use case:** Cut no-shows for demos, consultations, viewings and appointments by confirming by phone, without anyone on your team making the calls.
- **Who it is for:** Sales teams, clinics, agencies and service businesses that book meetings in Google Calendar.
- **Needs:** Ringee, Google Calendar
- **Ringee features:** AI Voice Agent: Start Call (with an Idempotency Key per meeting); Ringee Trigger: Call Completed and Call Failed; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API, Google Calendar OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A Google Calendar whose events carry the guest’s phone number in the description (Phone: +14155550123).
- An AI voice agent of type Reminders & Notifications.

**Configuration**

1. Create the Ringee API credential and select it on the four Ringee nodes; pick your agent in Start reminder call.
2. Select your calendar on the three Google Calendar nodes and connect Google Calendar.
3. Activate the workflow, then paste the Ringee Trigger Production URL into your Custom Integration as the Outbound URL and tick Call Completed and Call Failed.
4. Add Phone: and Name: lines to your event descriptions.

**Sample data:** The Ringee Trigger carries a pinned sample call.completed event (external ID reminder-sampleEventId123) so you can test the second half without waiting for a call.

**Error handling:** Events without a phone number are skipped. The same meeting never gets two calls (Idempotency Key = calendar event ID). If the AI analysis is not ready after seven minutes the workflow stops quietly and the call stays visible in Ringee. A number Ringee rejects (for example on the Do-Not-Call list) goes to its own output and the rest of the batch is still called.

**Expected result:** About an hour before each meeting the guest receives a call; shortly after it ends the event changes colour in Google Calendar.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 02: Qualify new leads with an AI phone call from Google Sheets using Ringee

Every new row in a leads sheet gets a call from an AI voice agent that asks your qualifying questions; the row is updated with the outcome, summary and sentiment.

- **File:** [`workflows/02-automatic-lead-qualification.json`](../workflows/02-automatic-lead-qualification.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/02-automatic-lead-qualification.json))
- **Business use case:** Speed to lead without an SDR: every inbound lead is contacted within minutes and the sheet always shows who was reached and what they said.
- **Who it is for:** Agencies and small sales teams that collect leads in Google Sheets.
- **Needs:** Ringee, Google Sheets
- **Ringee features:** AI Voice Agent: Start Call; Ringee Trigger: Call Completed and Call Failed; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API, Google Sheets OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A sheet with columns Name, Phone, Company, Status, Outcome, Summary, Sentiment.
- An AI voice agent of type Appointment Booking configured with your qualifying questions.

**Configuration**

1. Select your Ringee credential and agent.
2. Choose the same spreadsheet and sheet on the three Google Sheets nodes.
3. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL.

**Sample data:** Pinned sample call.completed event with external ID lead-2 (row 2 of the sheet).

**Error handling:** Rows without a phone number, or that already have a Status, are skipped. A row is marked “Calling” right after the call starts so it is not called twice. The Idempotency Key is the row number plus the phone number, so a reused row is not mistaken for an earlier lead. A number Ringee rejects goes to its own output and the other rows are still called. If the AI analysis is not ready after seven minutes the row says "Analysis pending" instead of claiming a result.

**Expected result:** New rows are called; when the call ends, Outcome, Summary and Sentiment are filled in.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 03: Follow up on missed meetings with an AI voice call and HubSpot

When a prospect misses a meeting, an AI voice agent phones them ten minutes later and offers a new time; when a new meeting is booked it is logged on the HubSpot contact.

> **Depends on something Ringee does not provide:** Ringee does not detect no-shows. The trigger is a webhook you send from another tool.

- **File:** [`workflows/03-missed-meeting-follow-up.json`](../workflows/03-missed-meeting-follow-up.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/03-missed-meeting-follow-up.json))
- **Business use case:** Recover no-shows while the conversation is still warm, without chasing them by hand.
- **Who it is for:** Sales teams that book demos through a scheduling tool and keep records in HubSpot.
- **Needs:** Ringee, HubSpot, A scheduling tool that can send a webhook on a no-show
- **Ringee features:** AI Voice Agent: Start Call; Ringee Trigger: Meeting Created
- **Credentials:** Ringee API, HubSpot OAuth2, Header Auth (protects the webhook)
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- An AI voice agent of type Appointment Booking with your calendar connected in Ringee.
- Something that tells n8n about a no-show (Calendly, Cal.com, Zoom, your CRM).

**Configuration**

1. In n8n create a Header Auth credential (a header name such as X-Webhook-Secret and a long random value) and select it on the webhook node; make your scheduling tool send the same header. Without it the workflow will not activate.
2. Point your scheduling tool’s no-show webhook at this workflow’s Meeting was missed URL, sending name, phone, email, meeting and meetingId.
3. Select your Ringee credential and agent, and connect HubSpot.
4. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL and tick Meeting Created.

**Sample data:** Webhook body {"name":"Ada Lovelace","phone":"+14155550123","email":"ada@example.com","meeting":"Product demo","meetingId":"mtg_123"}; pinned sample meeting.created event.

**Error handling:** Each missed meeting is called once (Idempotency Key = meeting ID). If HubSpot has no contact with that phone number nothing is logged. Only a caller that sends the secret header can start a call; anything else is refused before any number is read.

**Expected result:** The prospect is called about ten minutes after the no-show; a rebooked meeting appears as a meeting on the HubSpot contact.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 04: Call Facebook Lead Ads leads in minutes with a Ringee AI voice agent

A new Facebook lead is phoned by an AI voice agent straight away and, when the form gave an email, the lead is created or updated in HubSpot.

- **File:** [`workflows/04-facebook-lead-ads-ai-call.json`](../workflows/04-facebook-lead-ads-ai-call.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/04-facebook-lead-ads-ai-call.json))
- **Business use case:** Contact paid-ad leads while they still remember the ad, when conversion is highest.
- **Who it is for:** Marketing teams and agencies running Facebook and Instagram lead ads.
- **Needs:** Ringee, Facebook Lead Ads, HubSpot
- **Ringee features:** AI Voice Agent: Start Call; Ringee Trigger: Call Completed and Call Failed; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API, Facebook Lead Ads OAuth2, HubSpot OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A lead form that asks for a phone number and for consent to be called.

**Configuration**

1. Choose your Facebook page and form on the trigger.
2. Select the Ringee credential and agent; connect HubSpot.
3. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL.

**Sample data:** Pinned sample call.completed event with external ID fb-sample-lead-1.

**Error handling:** Leads without a phone number are skipped. Each lead is called once (Idempotency Key = lead ID). A lead without an email is called but not saved to HubSpot, so no placeholder contact is ever written.

**Expected result:** A new lead gets a call within about a minute; when it ends the contact is created or updated in HubSpot. The call and its summary stay in Ringee.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 05: Call every new HubSpot contact with a Ringee AI voice agent and log the call

A contact created in HubSpot is called by an AI voice agent and the call is logged on the contact with the AI’s summary.

- **File:** [`workflows/05-hubspot-lead-calling.json`](../workflows/05-hubspot-lead-calling.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/05-hubspot-lead-calling.json))
- **Business use case:** Warm every new contact immediately and keep the CRM timeline complete without manual logging.
- **Who it is for:** Teams whose lead intake lands in HubSpot (forms, imports, integrations).
- **Needs:** Ringee, HubSpot
- **Ringee features:** AI Voice Agent: Start Call; Ringee Trigger: Call Completed and Call Failed; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API, HubSpot OAuth2, HubSpot Developer API (for the trigger)
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- Contacts with a phone number, who agreed to be called.

**Configuration**

1. Connect HubSpot on the trigger and the HubSpot nodes.
2. Select the Ringee credential and agent.
3. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL.

**Sample data:** Pinned sample call.completed event with external ID hs-501 (HubSpot contact 501).

**Error handling:** Contacts without a phone are skipped; each contact is called once (Idempotency Key = contact ID). A number Ringee rejects goes to its own output and the rest of the batch is still called. If the AI analysis is not ready after seven minutes the call is logged as "analysis pending", with its real status (completed, busy, failed or no answer).

**Expected result:** The contact receives a call; a call activity with the outcome and summary appears on their HubSpot timeline.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 06: Call back missed calls automatically with a Ringee AI voice agent

When an inbound call goes unanswered, an AI voice agent calls the person back five minutes later and the callback is logged in a Google Sheet.

- **File:** [`workflows/06-automated-missed-call-callback.json`](../workflows/06-automated-missed-call-callback.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/06-automated-missed-call-callback.json))
- **Business use case:** Never lose a caller because nobody picked up; every missed call gets a prompt, polite callback.
- **Who it is for:** Small businesses, clinics and agencies with unstaffed hours.
- **Needs:** Ringee, Google Sheets
- **Ringee features:** Ringee Trigger: Call Missed; AI Voice Agent: Start Call
- **Credentials:** Ringee API, Google Sheets OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A sheet “Callback log” with columns Time, Caller, Our number, Callback call, Reason.

**Configuration**

1. Select the Ringee credential and agent.
2. Choose your spreadsheet and sheet on the Google Sheets node.
3. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL and tick Call Missed.

**Sample data:** Pinned sample call.missed event from +14155550123.

**Error handling:** A caller is called back at most once every four hours (Idempotency Key = the caller’s number and the four-hour window), so repeated calls are not answered with repeated calls and two Ringee numbers running this workflow cannot call each other forever.

**Expected result:** Five minutes after a missed call the caller receives a call from your AI agent and a row is added to the log.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 07: Notify your team about every AI receptionist call with a structured summary

When an AI receptionist call ends, the workflow reads what the AI learned and posts a clean record (who, why, urgency, callback number, summary) to Slack.

- **File:** [`workflows/07-ai-receptionist.json`](../workflows/07-ai-receptionist.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/07-ai-receptionist.json))
- **Business use case:** Nobody has to listen to recordings: the team sees who called and what they need.
- **Who it is for:** Businesses using the Ringee AI receptionist for incoming calls.
- **Needs:** Ringee, Slack
- **Ringee features:** Ringee Trigger: Call Completed; Transcript: Get AI Analysis
- **Credentials:** Ringee API, Slack OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- An AI receptionist agent assigned to a number in Ringee.

**Configuration**

1. Select the Ringee credential and connect Slack; choose the channel.
2. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL and tick Call Completed.
3. Tell your receptionist what to collect (name, reason, urgency, callback number).

**Sample data:** Pinned sample inbound call.completed event from +14155550123.

**Error handling:** Outbound calls are skipped. A missing field falls back to a readable default. If the AI analysis is not ready after seven minutes the team is told so, with urgency "unknown", instead of being told the call was normal.

**Expected result:** A message in your Slack channel within a few minutes of each receptionist call.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 08: Call new GoHighLevel leads with a Ringee AI voice agent and update the opportunity

A GoHighLevel workflow sends each new lead to n8n; an AI voice agent calls them and the opportunity is marked lost or kept open.

- **File:** [`workflows/08-gohighlevel-lead-automation.json`](../workflows/08-gohighlevel-lead-automation.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/08-gohighlevel-lead-automation.json))
- **Business use case:** Add AI phone follow-up to GoHighLevel pipelines without changing how leads arrive.
- **Who it is for:** Agencies and teams running their pipeline in GoHighLevel.
- **Needs:** Ringee, GoHighLevel
- **Ringee features:** AI Voice Agent: Start Call; Ringee Trigger: Call Completed and Call Failed; AI Voice Agent: Get Call Result
- **Credentials:** Ringee API, HighLevel API, Header Auth (protects the webhook)
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- A GoHighLevel workflow with a Webhook action that posts the lead to n8n.

**Configuration**

1. In n8n create a Header Auth credential (a header name such as X-Webhook-Secret and a long random value) and select it on the webhook node; make the GoHighLevel webhook action send the same header. Without it the workflow will not activate.
2. Add the webhook action in GoHighLevel with name, phone, email and opportunityId.
3. Select the Ringee credential and agent; connect HighLevel and choose a stage.
4. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL.

**Sample data:** Webhook body {"name":"Ada Lovelace","phone":"+14155550123","email":"ada@example.com","opportunityId":"opp_123"}.

**Error handling:** Each opportunity is called once (Idempotency Key = opportunity ID). Only a caller that sends the secret header can start a call; anything else is refused before any number is read. If the AI analysis is not ready after seven minutes the opportunity is left as it is.

**Expected result:** The lead is called; the opportunity status is updated when the call ends.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 09: Post call summaries and transcripts to Slack automatically with Ringee

When a recording is ready, the AI summary and the start of the transcript are posted to Slack.

> **Depends on something Ringee does not provide:** Ringee has no separate “transcript ready” event; the transcript arrives with Recording Ready.

- **File:** [`workflows/09-call-transcripts-to-slack.json`](../workflows/09-call-transcripts-to-slack.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/09-call-transcripts-to-slack.json))
- **Business use case:** Keep the team informed about customer conversations without anyone opening Ringee.
- **Who it is for:** Sales and support teams that review calls.
- **Needs:** Ringee, Slack
- **Ringee features:** Ringee Trigger: Recording Ready; Transcript: Get; Transcript: Get Summary
- **Credentials:** Ringee API, Slack OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- Call recording enabled in Ringee. Post only to a private channel and follow your recording-consent rules.

**Configuration**

1. Select the Ringee credential and connect Slack; choose a private channel.
2. Activate, then set the Ringee Trigger Production URL as the integration’s Outbound URL and tick Recording Ready.

**Sample data:** Pinned sample recording.ready event that already contains a transcript.

**Error handling:** If the transcript is not in the event, the workflow waits three minutes and fetches it. Only the first 700 characters are posted.

**Expected result:** A Slack message with the summary and transcript excerpt for every recorded call.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Template 10: AI agent that makes phone calls with Ringee tools in n8n

A chat-driven n8n AI Agent that can find contacts, start AI voice calls, read call results and fetch transcripts through Ringee tools, and asks for confirmation before every call.

- **File:** [`workflows/10-ai-agent-that-makes-phone-calls.json`](../workflows/10-ai-agent-that-makes-phone-calls.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/10-ai-agent-that-makes-phone-calls.json))
- **Business use case:** Let a teammate say “call Ada about tomorrow’s demo” in chat and have it done, safely.
- **Who it is for:** Teams building AI assistants and automation agencies.
- **Needs:** Ringee, An LLM provider (OpenAI in the template)
- **Ringee features:** Ringee Tool: Contact Get Many; Ringee Tool: Start Call; Ringee Tool: Get Call Result; Ringee Tool: Transcript Get
- **Credentials:** Ringee API, OpenAI API
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and at least one AI voice agent (Ringee → AI Voice Agents).
- A Ringee Custom Integration (Integrations → Custom Integrations) for the API key and Signing Secret.
- The Ringee community node installed in n8n (Settings → Community nodes → n8n-nodes-ringee).
- Self-hosted n8n: N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true.
- An OpenAI (or other chat model) credential.

**Configuration**

1. Select the Ringee credential on all four tools and pick the agent in Start call.
2. Select your chat model credential.
3. Open the chat and try “Call Ada Lovelace to confirm tomorrow’s demo”.

**Sample data:** Chat message: “Call +14155550123 and ask Alex if the delivery arrived.” (fictional number)

**Error handling:** The agent must get an explicit “yes” before calling. Delete operations are not offered to AI agents. Refusals (credits, Do-Not-Call) are explained, not retried.

**Expected result:** The assistant confirms, starts the call, returns the call ID and later reports the outcome.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)

---

## Alternative: AI appointment reminder with plain HTTP Request nodes (no community node needed)

The appointment reminder built only from n8n’s built-in HTTP Request nodes, for n8n Cloud and for trying Ringee before installing the community node.

- **File:** [`workflows/alternatives/01-ai-appointment-reminder-http-request.json`](../workflows/alternatives/01-ai-appointment-reminder-http-request.json) ([raw](https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/alternatives/01-ai-appointment-reminder-http-request.json))
- **Business use case:** Use Ringee from n8n Cloud today, or experiment without installing anything.
- **Who it is for:** n8n Cloud users and anyone evaluating Ringee.
- **Needs:** Ringee (HTTP API), Google Calendar
- **Ringee features:** REST: POST /api/v1/ai-voice-agents/:id/calls with an Idempotency-Key; REST: GET /api/v1/ai-voice-agents/calls/:id
- **Credentials:** Header Auth (X-Ringee-Api-Key), Google Calendar OAuth2
- **Publication:** Not published (draft)

**Prerequisites**

- A Ringee account with credits and an AI voice agent of type Reminders & Notifications.
- A Ringee Custom Integration API key.

**Configuration**

1. Create a Header Auth credential: name X-Ringee-Api-Key, value your cik_live_ key.
2. Replace YOUR_AGENT_ID in the URL of the first HTTP Request node.
3. Select your calendar on the Google Calendar nodes.

**Sample data:** Calendar event description: “Phone: +14155550123 / Name: Ada Lovelace”.

**Error handling:** Same protection against double calls as the Ringee-node version. It reads the result by waiting five minutes instead of using a trigger, so it needs no public webhook.

**Expected result:** Same as template 01, without the Ringee community node.

**Verification:** imported into n8n yes; nodes validated against n8n definitions yes; Ringee nodes run against a mock API yes; tested with live third-party accounts no.

[Ringee](https://ringee.io) · [Documentation](https://docs.ringee.io)
