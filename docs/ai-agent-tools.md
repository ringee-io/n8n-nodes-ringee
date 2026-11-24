# Using Ringee as a tool in an n8n AI Agent

Every operation of the Ringee node can be wired into n8n's **AI Agent** as **Ringee Tool**. An agent can then phone a customer, look a contact up, read how a call went and summarize the transcript.

## Enable it

- **n8n Cloud:** not available until the node is verified.
- **Self-hosted:** set `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true` on the n8n process and restart. Without it the tool variant is not offered.

Then in a workflow: add an **AI Agent**, connect a chat model and memory, and under _Tools_ add **Ringee Tool** once per capability. Choose the resource and operation on each tool; use **Let the model define this parameter** (the ✨ icon) on the fields the model should fill, such as the phone number.

```text
Chat Trigger → AI Agent ─┬─ Chat model
                         ├─ Memory
                         ├─ Ringee Tool: Contact → Get Many        "find a contact"
                         ├─ Ringee Tool: AI Voice Agent → Start Call   "call someone"
                         ├─ Ringee Tool: AI Voice Agent → Get Call Result
                         └─ Ringee Tool: Transcript → Get
```

[`workflows/10-ai-agent-that-makes-phone-calls.json`](../workflows/10-ai-agent-that-makes-phone-calls.json) is this, ready to import, with a system message that requires your explicit yes before every call.

## Examples

| You say                                                           | The agent uses                   |
| ----------------------------------------------------------------- | -------------------------------- |
| "Call this customer to confirm tomorrow's meeting."               | Find contact → Start call        |
| "Contact this new lead and qualify their interest."               | Start call, then Get call result |
| "Retrieve the last call transcript and summarize the objections." | Get transcript                   |
| "How did the call to Ada go?"                                     | Get call result                  |

Availability and meeting scheduling are not offered: Ringee has no public route for them yet ([matrix](api-capability-matrix.md)).

## Safety

| Risk                                | What protects you                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent deletes data              | **Delete is not in the tool's operation list.** Only a person editing a normal workflow can choose it, and it needs the contact's own phone number.                                                                 |
| The agent dials without asking      | Not enforced by the node: it is a tool. The template's system message requires an explicit "yes". For production add n8n's **human approval** step in front of the Start Call tool, so a person confirms each call. |
| The agent calls a number it made up | The template tells it to call only numbers the user gave or a contact it found. A wrong number is still dialed if approved: approval is the control.                                                                |
| Cost                                | Ringee refuses a call when credits are out, a number is on the Do-Not-Call list or calling is disabled, whatever the agent asks.                                                                                    |
| A retry places a second call        | Each call carries an idempotency key built from the execution; a retried tool call returns the first call ([idempotency](idempotency.md)).                                                                          |
| Reaching other workspaces           | Impossible: the API key fixes the workspace. The model supplies phone numbers and text, never a workspace or user id.                                                                                               |
| Tool output filling the context     | Contact and call results are plain JSON of modest size; _Call → Get_ is simplified by default. An _Output_ selector for AI use is planned ([checklist](n8n-verification-checklist.md)).                             |

Recordings and transcripts are sensitive personal data. If you give an agent the Transcript or Recording tools, the content goes to your chat model provider: choose one that your privacy rules allow.
