import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ringeeRequest } from '../../../lib/api/client';
import type { RingeeCallDetail } from '../../../lib/types';
import { textValue } from './execution';

/**
 * The call as Ringee holds it — the same object a webhook event carries as
 * `data.call`. The Call, Recording and Transcript operations each read their own
 * part of it, so they all share this one request.
 */
export async function fetchCallDetail(
	ctx: IExecuteFunctions,
	itemIndex: number,
): Promise<{ callId: string; call: RingeeCallDetail }> {
	const callId = textValue(ctx, 'callId', itemIndex);
	if (!callId) {
		throw new NodeOperationError(ctx.getNode(), 'Enter the ID of the call.', {
			itemIndex,
			description: "Fix the 'Call ID' field. Start Call returns it as call_id.",
		});
	}
	const call = await ringeeRequest<RingeeCallDetail>(ctx, {
		method: 'GET',
		path: `/v1/calls/${encodeURIComponent(callId)}`,
		itemIndex,
		subject: 'call',
	});
	return { callId, call };
}

/** The handful of fields most workflows need from a call. */
export function simplifyCall(call: RingeeCallDetail): IDataObject {
	const ai = call.voiceAgentCall;
	return {
		callId: call.callId,
		direction: call.direction,
		status: call.status,
		source: call.source ?? null,
		fromNumber: call.fromNumber,
		toNumber: call.toNumber,
		startedAt: call.startedAt ?? null,
		answeredAt: call.answeredAt ?? null,
		endedAt: call.endedAt ?? null,
		durationSeconds: call.durationSeconds ?? null,
		outcome: call.outcome ?? null,
		outcomeNote: call.outcomeNote ?? null,
		contact: (call.contact as IDataObject | undefined) ?? null,
		recordingAvailable: Boolean(call.recording?.url),
		transcriptAvailable: Boolean(call.transcription?.text),
		aiAgent: (ai?.agent as IDataObject | undefined) ?? null,
		aiSummary: ai?.summary ?? null,
		aiSentiment: ai?.sentiment ?? null,
		aiOutcome: ai?.outcome ?? null,
		extractedData: (ai?.extractedData as IDataObject | undefined) ?? null,
	};
}
