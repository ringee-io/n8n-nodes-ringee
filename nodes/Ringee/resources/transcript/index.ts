import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { callIdField, forOperation } from '../../shared/fields';
import { fetchCallDetail } from '../../shared/call-detail';
import { toItems } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'transcript';

const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		default: 'get',
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve the transcript of a call',
				action: 'Get a transcript',
			},
			{
				name: 'Get AI Analysis',
				value: 'getAnalysis',
				description:
					'Retrieve what the AI voice agent concluded: outcome, summary, sentiment and data',
				action: 'Get the AI analysis of a call',
			},
			{
				name: 'Get Extracted Information',
				value: 'getExtractedInformation',
				description: 'Retrieve the structured data the AI voice agent collected on the call',
				action: 'Get the information extracted from a call',
			},
			{
				name: 'Get Summary',
				value: 'getSummary',
				description: 'Retrieve the AI voice agent’s summary of the call',
				action: 'Get the summary of a call',
			},
		],
	},
	callIdField(
		forOperation(RESOURCE, ['get', 'getAnalysis', 'getExtractedInformation', 'getSummary']),
	),
	{
		displayName: 'Include Segments',
		name: 'includeSegments',
		type: 'boolean',
		default: false,
		description:
			'Whether to also return the transcript split into timed segments with the speaker of each',
		displayOptions: forOperation(RESOURCE, ['get']),
	},
];

/**
 * The transcript and the analysis are produced after the call ends, so the
 * first read of a call that just finished may find neither. Each operation
 * says so (`ready: false`) rather than failing, so a workflow can wait and ask
 * again — or, better, react to the event that announces the result.
 */
const get: OperationHandler = async (ctx, itemIndex) => {
	const { callId, call } = await fetchCallDetail(ctx, itemIndex);
	const includeSegments = ctx.getNodeParameter('includeSegments', itemIndex, false) as boolean;
	const transcription = call.transcription;
	const ready = Boolean(transcription?.text);
	return toItems(
		{
			callId: call.callId ?? callId,
			ready,
			status: transcription?.status ?? null,
			language: transcription?.language ?? null,
			text: transcription?.text ?? null,
			...(includeSegments
				? { segments: (transcription?.segments ?? []) as unknown as IDataObject[] }
				: {}),
		},
		itemIndex,
	);
};

const getAnalysis: OperationHandler = async (ctx, itemIndex) => {
	const { callId, call } = await fetchCallDetail(ctx, itemIndex);
	const ai = call.voiceAgentCall;
	return toItems(
		{
			callId: call.callId ?? callId,
			aiAgentCall: Boolean(ai),
			ready: Boolean(ai?.summary || ai?.outcome),
			agent: (ai?.agent as IDataObject | undefined) ?? null,
			status: ai?.status ?? null,
			outcome: ai?.outcome ?? null,
			summary: ai?.summary ?? null,
			sentiment: ai?.sentiment ?? null,
			extractedData: (ai?.extractedData as IDataObject | undefined) ?? null,
		},
		itemIndex,
	);
};

const getSummary: OperationHandler = async (ctx, itemIndex) => {
	const { callId, call } = await fetchCallDetail(ctx, itemIndex);
	const ai = call.voiceAgentCall;
	return toItems(
		{
			callId: call.callId ?? callId,
			aiAgentCall: Boolean(ai),
			ready: Boolean(ai?.summary),
			summary: ai?.summary ?? null,
		},
		itemIndex,
	);
};

const getExtractedInformation: OperationHandler = async (ctx, itemIndex) => {
	const { callId, call } = await fetchCallDetail(ctx, itemIndex);
	const ai = call.voiceAgentCall;
	return toItems(
		{
			callId: call.callId ?? callId,
			aiAgentCall: Boolean(ai),
			ready: Boolean(ai?.extractedData && Object.keys(ai.extractedData).length > 0),
			extractedData: (ai?.extractedData as IDataObject | undefined) ?? {},
		},
		itemIndex,
	);
};

export const transcript: ResourceModule = {
	description,
	operations: { get, getAnalysis, getSummary, getExtractedInformation },
};
