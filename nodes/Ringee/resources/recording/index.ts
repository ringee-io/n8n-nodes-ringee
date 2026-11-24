import type { IBinaryKeyData, IDataObject, INodeProperties } from 'n8n-workflow';
import { ringeeRequestBinary } from '../../../../lib/api/client';
import { callIdField, forOperation } from '../../shared/fields';
import { fetchCallDetail } from '../../shared/call-detail';
import { textValue, toItems } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'recording';

const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		default: 'download',
		options: [
			{
				name: 'Download',
				value: 'download',
				description: 'Download the recording of a call as an audio file',
				action: 'Download a recording',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Check whether a call has a recording and retrieve its details',
				action: 'Get a recording',
			},
		],
	},
	callIdField(forOperation(RESOURCE, ['get', 'download'])),
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the output binary field to put the file in',
		displayOptions: forOperation(RESOURCE, ['download']),
	},
];

const get: OperationHandler = async (ctx, itemIndex) => {
	const { callId, call } = await fetchCallDetail(ctx, itemIndex);
	const recording = call.recording;
	return toItems(
		{
			callId: call.callId ?? callId,
			available: Boolean(recording?.url),
			status: recording?.status ?? null,
			format: recording?.format ?? null,
			durationSec: recording?.durationSec ?? null,
			// A shareable link to the audio. Treat it like the recording itself.
			url: recording?.url ?? null,
		},
		itemIndex,
	);
};

const download: OperationHandler = async (ctx, itemIndex) => {
	const callId = textValue(ctx, 'callId', itemIndex);
	const binaryPropertyName = ctx.getNodeParameter(
		'binaryPropertyName',
		itemIndex,
		'data',
	) as string;

	const file = await ringeeRequestBinary(ctx, {
		method: 'GET',
		path: `/v1/calls/${encodeURIComponent(callId)}/recording`,
		itemIndex,
		subject: 'recording',
		timeoutMs: 120_000,
	});
	const fileName = `recording-${callId}.mp3`;
	const binary = await ctx.helpers.prepareBinaryData(
		file.data,
		fileName,
		file.contentType?.split(';')[0] ?? 'audio/mpeg',
	);
	const data: IBinaryKeyData = { [binaryPropertyName]: binary };
	return [
		{
			json: {
				callId,
				fileName,
				mimeType: binary.mimeType,
				sizeBytes: file.data.length,
			} as IDataObject,
			binary: data,
			pairedItem: { item: itemIndex },
		},
	];
};

export const recording: ResourceModule = {
	description,
	operations: { get, download },
};
