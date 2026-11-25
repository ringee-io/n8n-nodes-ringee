import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ringeeRequest, ringeeRequestAllItems } from '../../../../lib/api/client';
import { requireCapability } from '../../../../lib/api/capabilities';
import { createHash } from 'crypto';
import {
	AGENT_CALL_FINAL_STATUSES,
	type AgentCallStatus,
	type RingeeAgent,
	type RingeeAgentCallResult,
	type RingeeStartCallResponse,
} from '../../../../lib/types';
import { automaticIdempotencyKey, isValidIdempotencyKey } from '../../../../lib/utils/idempotency';
import { cleanPhoneNumber } from '../../../../lib/utils/phone';
import { agentLocator, callIdField, forOperation, paging } from '../../shared/fields';
import { locatorValue, textValue, toItems, withoutEmpty } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'aiAgent';

const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		default: 'startCall',
		options: [
			{
				name: 'Cancel Call',
				value: 'cancelCall',
				description:
					'Withdraw a call that is still waiting for call capacity. A call that is already dialing cannot be cancelled this way.',
				action: 'Cancel a call that has not been dialed',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve an AI voice agent and the variables its calls accept',
				action: 'Get an AI voice agent',
			},
			{
				name: 'Get Call Result',
				value: 'getCallResult',
				description: 'Retrieve the outcome, summary and extracted data of an AI voice agent call',
				action: 'Get the result of an AI voice agent call',
			},
			{
				name: 'Get Call Status',
				value: 'getCallStatus',
				description: 'Check whether an AI voice agent call is still in progress',
				action: 'Get the status of an AI voice agent call',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Retrieve a list of AI voice agents',
				action: 'Get many AI voice agents',
			},
			{
				name: 'Get Many Calls',
				value: 'getManyCalls',
				description: 'Retrieve a list of the calls an AI voice agent has made',
				action: 'Get many calls of an AI voice agent',
			},
			{
				name: 'Start Call',
				value: 'startCall',
				description:
					'Start a phone call with an AI voice agent. Returns a durable call ID with queued or initiating status; the result arrives later.',
				action: 'Start a call with an AI voice agent',
			},
		],
	},

	// ── Get / Get Many Calls ──────────────────────────────────────────────
	agentLocator(forOperation(RESOURCE, ['get', 'getManyCalls'])),

	// ── Get Many ──────────────────────────────────────────────────────────
	...paging(forOperation(RESOURCE, ['getMany', 'getManyCalls'])),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: forOperation(RESOURCE, ['getMany']),
		options: [
			{
				displayName: 'Type',
				name: 'type',
				type: 'options',
				default: 'appointment_booking',
				description: 'Only return agents of this type',
				options: [
					{ name: 'Appointment Booking', value: 'appointment_booking' },
					{ name: 'Reminders & Notifications', value: 'reminders_notifications' },
				],
			},
		],
	},

	// ── Start Call ────────────────────────────────────────────────────────
	agentLocator(forOperation(RESOURCE, ['startCall'])),
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. +14155550123',
		description:
			'The number to call, in international format. Use an expression to read it from the previous node.',
		displayOptions: forOperation(RESOURCE, ['startCall']),
	},
	{
		displayName: 'Variables',
		name: 'variables',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description:
			'What the agent knows about this call, such as the first name of the person. The fields come from the agent you selected.',
		displayOptions: forOperation(RESOURCE, ['startCall']),
		typeOptions: {
			loadOptionsDependsOn: ['agentId.value'],
			resourceMapper: {
				resourceMapperMethod: 'getAgentVariables',
				mode: 'add',
				fieldWords: { singular: 'variable', plural: 'variables' },
				addAllFields: true,
				multiKeyMatch: false,
				supportAutoMap: true,
				noFieldsError: 'Select an AI voice agent first. This agent type has no variables.',
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: forOperation(RESOURCE, ['startCall']),
		options: [
			{
				displayName: 'Caller Number',
				name: 'callerNumberId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				description:
					'The number the person sees. Leave empty to use the one assigned to the agent.',
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a number…',
						typeOptions: { searchListMethod: 'getCallerNumbers', searchable: true },
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. 123e4567-e89b-42d3-a456-426614174000',
					},
				],
			},
			{
				displayName: 'External ID',
				name: 'externalId',
				type: 'string',
				default: '',
				placeholder: 'e.g. calendar-event-123',
				description:
					'Your own identifier for this call, such as a CRM record or calendar event ID. Ringee returns it as externalId on every event about the call, so a Ringee Trigger workflow can find the record again.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				placeholder: 'e.g. reminder-{{ $json.eventId }}',
				description:
					'Prevents a second paid call when the same request is repeated. Ringee places the call once per key and returns that call again for any repeat. Leave empty to let the node use a key that is unique to this execution and item, which protects against retries. Set your own, such as one per calendar event, to also protect across executions.',
			},
			{
				displayName: 'Metadata (JSON)',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Extra data stored with the call and returned in its result',
			},
		],
	},

	// ── Call status / result ──────────────────────────────────────────────
	callIdField(forOperation(RESOURCE, ['getCallStatus', 'getCallResult', 'cancelCall'])),
];

const getMany: OperationHandler = async (ctx, itemIndex) => {
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = ctx.getNodeParameter('limit', itemIndex, 50) as number;
	const filters = ctx.getNodeParameter('filters', itemIndex, {}) as { type?: string };

	const agents = await ringeeRequestAllItems<RingeeAgent>(
		ctx,
		{
			method: 'GET',
			path: '/v1/ai-voice-agents',
			qs: withoutEmpty({ type: filters.type }),
			itemIndex,
			subject: 'AI voice agent',
		},
		{ returnAll, limit },
	);
	return toItems(agents as unknown as IDataObject[], itemIndex);
};

const get: OperationHandler = async (ctx, itemIndex) => {
	const agentId = locatorValue(ctx, 'agentId', itemIndex);
	const agent = await ringeeRequest<RingeeAgent>(ctx, {
		method: 'GET',
		path: `/v1/ai-voice-agents/${encodeURIComponent(agentId)}`,
		itemIndex,
		subject: 'AI voice agent',
	});
	return toItems(agent as unknown as IDataObject, itemIndex);
};

const getManyCalls: OperationHandler = async (ctx, itemIndex) => {
	const agentId = locatorValue(ctx, 'agentId', itemIndex);
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = ctx.getNodeParameter('limit', itemIndex, 50) as number;

	const calls = await ringeeRequestAllItems<RingeeAgentCallResult>(
		ctx,
		{
			method: 'GET',
			path: `/v1/ai-voice-agents/${encodeURIComponent(agentId)}/calls`,
			itemIndex,
			subject: 'AI voice agent',
		},
		{ returnAll, limit },
	);
	return toItems(calls.map((call) => withFinished(call)) as unknown as IDataObject[], itemIndex);
};

const startCall: OperationHandler = async (ctx, itemIndex) => {
	const agentId = locatorValue(ctx, 'agentId', itemIndex);
	const options = ctx.getNodeParameter('options', itemIndex, {}) as {
		callerNumberId?: { value?: string } | string;
		externalId?: string;
		idempotencyKey?: string;
		metadata?: string | IDataObject;
	};

	const phone = cleanPhoneNumber(ctx.getNodeParameter('phoneNumber', itemIndex, ''));
	if (!phone.value) {
		throw new NodeOperationError(ctx.getNode(), phone.problem ?? 'Enter the phone number.', {
			itemIndex,
			description: "Fix the 'Phone Number' field.",
		});
	}

	const metadata = parseMetadata(ctx, options.metadata, itemIndex);
	if (options.externalId?.trim()) metadata.external_id = options.externalId.trim();

	const callerNumberId =
		typeof options.callerNumberId === 'string'
			? options.callerNumberId
			: (options.callerNumberId?.value ?? '');

	// A server that would ignore the Idempotency-Key must be found out before a
	// paid call is placed, not after a retry has placed a second one.
	await requireCapability(ctx, 'idempotentCalls', itemIndex);

	const idempotencyKey = resolveIdempotencyKey(
		ctx,
		options.idempotencyKey,
		itemIndex,
		agentId,
		phone.value,
	);

	if (!idempotencyKey) {
		throw new NodeOperationError(ctx.getNode(), 'Enter a stable Idempotency Key for this call.', {
			itemIndex,
			description:
				'This execution has no stable identity. Use a persistent record-based key so retries cannot place another paid call.',
		});
	}

	const started = await ringeeRequest<RingeeStartCallResponse>(ctx, {
		method: 'POST',
		path: `/v1/ai-voice-agents/${encodeURIComponent(agentId)}/calls`,
		body: withoutEmpty({
			to: phone.value,
			from_number_id: callerNumberId.trim(),
			variables: readVariables(ctx, itemIndex),
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		}),
		idempotencyKey,
		itemIndex,
		subject: 'AI voice agent',
		timeoutMs: 60_000,
	});

	return toItems(
		{
			call_id: started.id,
			status: started.status,
			finished: isFinished(started.status),
			// A call Ringee accepted but has not dialed: it is waiting for call
			// capacity. Nothing has been dialed or charged yet, and `expires_at` is
			// when it gives up. Branch on this, not on the status text.
			queued: started.status === 'queued',
			...(started.idempotent_replayed !== undefined
				? { idempotent_replayed: started.idempotent_replayed }
				: {}),
			...(started.queued_at ? { queued_at: started.queued_at } : {}),
			...(started.expires_at ? { expires_at: started.expires_at } : {}),
		},
		itemIndex,
	);
};

const cancelCall: OperationHandler = async (ctx, itemIndex) => {
	const callId = textValue(ctx, 'callId', itemIndex);
	if (!callId) {
		throw new NodeOperationError(ctx.getNode(), 'Enter the ID of the call.', {
			itemIndex,
			description: "Fix the 'Call ID' field. Start Call returns it as call_id.",
		});
	}
	// A server that predates the queue has nothing to cancel: say so before
	// sending, instead of answering the 404 of a route it does not have.
	await requireCapability(ctx, 'queuedCalls', itemIndex);
	const cancelled = await ringeeRequest<{ id: string; status: AgentCallStatus }>(ctx, {
		method: 'POST',
		path: `/v1/ai-voice-agents/calls/${encodeURIComponent(callId)}/cancel`,
		itemIndex,
		subject: 'call',
	});
	return toItems(
		{
			call_id: cancelled.id,
			status: cancelled.status,
			finished: isFinished(cancelled.status),
			queued: false,
		},
		itemIndex,
	);
};

const getCallResult: OperationHandler = async (ctx, itemIndex) => {
	const result = await readCall(ctx, itemIndex);
	return toItems(withFinished(result) as unknown as IDataObject, itemIndex);
};

const getCallStatus: OperationHandler = async (ctx, itemIndex) => {
	const result = await readCall(ctx, itemIndex);
	return toItems(
		{
			call_id: result.call_id,
			status: result.status,
			finished: isFinished(result.status),
			queued: result.status === 'queued',
			...(result.queued_at ? { queued_at: result.queued_at } : {}),
			...(result.expires_at ? { expires_at: result.expires_at } : {}),
			outcome: result.outcome,
		},
		itemIndex,
	);
};

async function readCall(
	ctx: Parameters<OperationHandler>[0],
	itemIndex: number,
): Promise<RingeeAgentCallResult> {
	const callId = textValue(ctx, 'callId', itemIndex);
	if (!callId) {
		throw new NodeOperationError(ctx.getNode(), 'Enter the ID of the call.', {
			itemIndex,
			description: "Fix the 'Call ID' field. Start Call returns it as call_id.",
		});
	}
	return ringeeRequest<RingeeAgentCallResult>(ctx, {
		method: 'GET',
		path: `/v1/ai-voice-agents/calls/${encodeURIComponent(callId)}`,
		itemIndex,
		subject: 'call',
	});
}

function isFinished(status: AgentCallStatus | string): boolean {
	return (AGENT_CALL_FINAL_STATUSES as readonly string[]).includes(status);
}

/** True once the call has reached a final status, so a workflow can branch on it. */
function withFinished(
	result: RingeeAgentCallResult,
): RingeeAgentCallResult & { finished: boolean; queued: boolean } {
	return { ...result, finished: isFinished(result.status), queued: result.status === 'queued' };
}

function parseMetadata(
	ctx: Parameters<OperationHandler>[0],
	raw: string | IDataObject | undefined,
	itemIndex: number,
): IDataObject {
	if (raw === undefined || raw === null || raw === '') return {};
	if (typeof raw === 'object') return { ...(raw as IDataObject) };
	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
			return parsed as IDataObject;
	} catch {
		// reported below
	}
	throw new NodeOperationError(ctx.getNode(), "'Metadata (JSON)' must be a JSON object", {
		itemIndex,
		description: 'For example {"crm_id": "123"}.',
	});
}

function resolveIdempotencyKey(
	ctx: Parameters<OperationHandler>[0],
	chosen: string | undefined,
	itemIndex: number,
	agentId: string,
	destination: string,
): string | undefined {
	const key = chosen?.trim();
	if (key) {
		if (!isValidIdempotencyKey(key)) {
			throw new NodeOperationError(
				ctx.getNode(),
				"The 'Idempotency Key' can use letters, digits and . _ : @ / + = ~ - (up to 255 characters)",
				{ itemIndex, description: 'For example reminder-evt_123.' },
			);
		}
		return key;
	}
	let runIndex = 0;
	try {
		runIndex = Number(ctx.evaluateExpression('{{ $runIndex }}', itemIndex)) || 0;
	} catch {
		// A context without run indexes still produces a key per item.
	}
	const workflow = ctx.getWorkflow();
	// An AI model decides when this runs, and may ask for the same call twice;
	// each ask is a new run of the node, so it is the call that is named.
	const operation = isAiTool(ctx)
		? createHash('sha256').update(`${agentId}\n${destination}`).digest('hex').slice(0, 24)
		: undefined;
	return automaticIdempotencyKey({
		workflowId: workflow.id,
		executionId: safeExecutionId(ctx),
		nodeId: ctx.getNode().id,
		runIndex,
		itemIndex,
		operation,
	});
}

/** Whether an AI agent, not a fixed workflow step, is running this node. */
function isAiTool(ctx: Parameters<OperationHandler>[0]): boolean {
	return ctx.getNode().type.endsWith('Tool');
}

function safeExecutionId(ctx: Parameters<OperationHandler>[0]): string | undefined {
	try {
		return ctx.getExecutionId() || undefined;
	} catch {
		return undefined;
	}
}

/** The mapper's values, as the strings Ringee expects. */
function readVariables(
	ctx: Parameters<OperationHandler>[0],
	itemIndex: number,
): IDataObject | undefined {
	const mapper = ctx.getNodeParameter('variables', itemIndex, {}) as {
		mappingMode?: string;
		value?: IDataObject | null;
		schema?: Array<{ id: string }>;
	};
	let source: IDataObject = {};
	if (mapper.mappingMode === 'autoMapInputData') {
		const known = new Set((mapper.schema ?? []).map((field) => field.id));
		const input = ctx.getInputData()[itemIndex]?.json ?? {};
		source = Object.fromEntries(Object.entries(input).filter(([key]) => known.has(key)));
	} else if (mapper.value && typeof mapper.value === 'object') {
		source = mapper.value;
	}

	const variables: IDataObject = {};
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined || value === null) continue;
		const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
		if (text.trim() !== '') variables[key] = text;
	}
	return Object.keys(variables).length > 0 ? variables : undefined;
}

export const aiAgent: ResourceModule = {
	description,
	operations: {
		cancelCall,
		get,
		getMany,
		getManyCalls,
		getCallResult,
		getCallStatus,
		startCall,
	},
};
