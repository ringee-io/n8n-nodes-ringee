/**
 * Contracts of Ringee's public REST API (`/api/v1`) and of the webhook events it
 * sends. They are written from the API's behaviour and documented in
 * docs/api-capability-matrix.md; nothing here is imported from Ringee's source.
 */

// ── Calls ───────────────────────────────────────────────────────────────────

/**
 * Status of an AI voice agent call.
 *
 * `queued` is a call Ringee accepted but has not dialed: it is waiting for
 * provider capacity (docs/queue-and-capacity.md). It becomes `initiating` when
 * it is placed, or `cancelled` / `expired` when it never will be. None of those
 * three has dialed anything or cost anything.
 */
export const AGENT_CALL_STATUSES = [
	'queued',
	'created',
	'initiating',
	'ringing',
	'in_progress',
	'completed',
	'no_answer',
	'busy',
	'voicemail',
	'failed',
	'cancelled',
	'expired',
] as const;
export type AgentCallStatus = (typeof AGENT_CALL_STATUSES)[number];

/** A final status never changes again: the last seven. */
export const AGENT_CALL_FINAL_STATUSES: readonly AgentCallStatus[] = [
	'completed',
	'no_answer',
	'busy',
	'voicemail',
	'failed',
	'cancelled',
	'expired',
];

/** Statuses of a call that was never dialed, and never will be. */
export const AGENT_CALL_NOT_DIALED_STATUSES: readonly AgentCallStatus[] = [
	'queued',
	'cancelled',
	'expired',
];

/** Outcomes an AI voice agent reports; the first two groups are legacy spellings. */
export const AGENT_OUTCOMES = [
	'meeting_booked',
	'callback_scheduled',
	'not_interested',
	'no_answer',
	'no_conversation',
	'wrong_number',
	'confirmed',
	'cannot_attend',
	'callback_requested',
	'appointment_booked',
	'unknown',
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

/** Status of a call in Ringee's call history (human or AI). */
export const CALL_STATUSES = [
	'pending',
	'ringing',
	'answered',
	'recording',
	'completed',
	'failed',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** The closed set of outcomes a call can be recorded with. */
export const CALL_OUTCOMES = [
	'meeting_booked',
	'sale',
	'interested',
	'follow_up',
	'callback_scheduled',
	'not_interested',
	'no_answer',
	'no_conversation',
	'voicemail',
	'wrong_number',
	'gatekeeper',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

// ── AI voice agents ─────────────────────────────────────────────────────────

export type AgentType = 'appointment_booking' | 'reminders_notifications' | 'receptionist';

export interface RingeeVariableDefinition {
	key: string;
	label: string;
	required: boolean;
	description?: string;
}

export interface RingeeAgent {
	id: string;
	name: string;
	type: AgentType;
	status: string;
	voice: string | null;
	callCount: number;
	callerNumberId: string | null;
	callsFrom: string | null;
	createdAt: string;
	updatedAt: string;
	/** Present on a single-agent read only. */
	variables?: RingeeVariableDefinition[];
}

export interface RingeeCallerNumber {
	id: string;
	phoneNumber: string;
	isoCountry: string | null;
	kind: string;
}

export interface RingeePage<T> {
	data: T[];
	total: number;
	page: number;
	limit: number;
	totalPages?: number;
}

export interface RingeeAgentList extends RingeePage<RingeeAgent> {
	callerNumbers: RingeeCallerNumber[];
	variablesByType: Record<string, RingeeVariableDefinition[]>;
}

export interface RingeeStartCallResponse {
	id: string;
	status: AgentCallStatus;
	/** Only present when an Idempotency-Key was sent. */
	idempotent_replayed?: boolean;
	/** Only while the call is `queued`: when it was accepted and when it gives up waiting. */
	queued_at?: string;
	expires_at?: string;
}

export interface RingeeAgentCallResult {
	call_id: string;
	status: AgentCallStatus;
	queued_at?: string;
	expires_at?: string;
	outcome: AgentOutcome | null;
	summary: string | null;
	sentiment: string | null;
	extracted_data: Record<string, unknown>;
	metadata: Record<string, unknown>;
	appointment?: { id: string; start: string; end: string };
}

// ── Contacts ────────────────────────────────────────────────────────────────

export interface RingeeContact {
	id: string;
	name: string | null;
	firstName: string | null;
	lastName: string | null;
	phoneNumber: string;
	email: string | null;
	company: string | null;
	jobTitle: string | null;
	state: string | null;
	website: string | null;
	revenue: string | null;
	companySize: string | null;
	source: string | null;
	lastCallAt: string | null;
	createdAt: string;
	updatedAt: string;
}

// ── Call history ────────────────────────────────────────────────────────────

export interface RingeeCallSummary {
	id: string;
	direction: 'inbound' | 'outbound';
	status: CallStatus;
	source: string | null;
	fromNumber: string;
	toNumber: string;
	contactId: string | null;
	startedAt: string | null;
	answeredAt: string | null;
	endedAt: string | null;
	createdAt: string;
	durationSeconds: number | null;
	outcome: CallOutcome | null;
	outcomeNote: string | null;
	dispositionName: string | null;
}

export interface RingeeTranscriptSegment {
	text: string;
	speaker?: number;
	track?: string;
	startMs?: number;
	endMs?: number;
}

/**
 * The call as `data.call` carries it in webhook events, and as
 * `GET /api/v1/calls/:id` returns it. Fields without a value yet are omitted.
 */
export interface RingeeCallDetail {
	callId: string;
	fromNumber: string;
	toNumber: string;
	status: string;
	direction: string;
	source?: string;
	startedAt?: string;
	answeredAt?: string;
	endedAt?: string;
	createdAt?: string;
	durationSeconds?: number;
	outcome?: string;
	outcomeNote?: string;
	disposition?: { id: string; name: string | null };
	contact?: { id: string; phoneNumber?: string; fullName?: string; email?: string };
	recording?: {
		recordingId?: string;
		url?: string;
		status?: string;
		format?: string;
		durationSec?: number;
	};
	transcription?: {
		source?: string;
		status?: string;
		language?: string;
		confidence?: number;
		completedAt?: string;
		text?: string;
		segments?: RingeeTranscriptSegment[];
	};
	voiceAgentCall?: {
		id: string;
		agent?: { id: string; name: string };
		status?: string;
		outcome?: string;
		summary?: string;
		sentiment?: string;
		extractedData?: Record<string, unknown>;
		variables?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
	};
	meetings?: Array<Record<string, unknown>>;
	callbacks?: Array<Record<string, unknown>>;
	campaignAttempts?: Array<Record<string, unknown>>;
}

// ── Webhook events ──────────────────────────────────────────────────────────

/** The events Ringee sends, with the labels the Ringee Trigger shows. */
export const RINGEE_EVENTS = [
	{
		value: 'call.completed',
		name: 'Call Completed',
		description: 'A call has ended, human or AI. The outcome and AI analysis may arrive later',
	},
	{
		value: 'call.outcome.updated',
		name: 'Call Outcome Updated',
		description:
			'An outcome was recorded, including an AI voice agent’s post-call result with summary, sentiment and extracted data',
	},
	{
		value: 'call.failed',
		name: 'Call Failed',
		description: 'A call could not be connected',
	},
	{
		value: 'call.missed',
		name: 'Call Missed',
		description: 'An inbound call was not answered',
	},
	{
		value: 'recording.ready',
		name: 'Recording Ready',
		description: 'The recording of a call has been processed',
	},
	{
		value: 'meeting.created',
		name: 'Meeting Created',
		description: 'A meeting was booked, by a person or by an AI voice agent',
	},
	{
		value: 'callback.created',
		name: 'Callback Created',
		description: 'A callback was scheduled, by a person or by an AI voice agent',
	},
	{
		value: 'note.created',
		name: 'Note Created',
		description: 'A note was added to a contact',
	},
	{
		value: 'dnc.created',
		name: 'Do-Not-Call Entry Created',
		description: 'A number was added to the Do-Not-Call list',
	},
] as const;
export type RingeeEventName = (typeof RINGEE_EVENTS)[number]['value'];

/** Sent by Ringee's “Send test” button in the integration settings. */
export const RINGEE_TEST_EVENT = 'test.ping';

export interface RingeeWebhookEnvelope {
	event: string;
	eventId: string;
	occurredAt: string;
	workspaceId?: string;
	integrationId?: string;
	data: Record<string, unknown> & {
		callId?: string;
		agentCallId?: string;
		externalId?: string;
		agent?: { id: string; name: string };
		call?: RingeeCallDetail;
	};
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** The body NestJS puts on an error response. */
export interface RingeeErrorBody {
	statusCode?: number;
	message?: string | string[];
	error?: string;
	/** A stable name for the refusal, when Ringee gives one (for example `idempotency_key_failed`). */
	code?: string;
	fields?: Record<string, string | string[]>;
}
