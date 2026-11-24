import type {
	ILoadOptionsFunctions,
	ResourceMapperField,
	ResourceMapperFields,
} from 'n8n-workflow';
import { ringeeRequest } from '../../../lib/api/client';
import type { RingeeAgent } from '../../../lib/types';

/**
 * The variables the selected AI voice agent accepts, as mappable fields.
 *
 * Each agent type defines its own: a reminder agent wants a first name and what
 * the reminder is about, an appointment agent wants other things. Reading them
 * from the agent means the node always offers what that agent expects, and
 * marks the ones Ringee will refuse the call without as required.
 */
export async function getAgentVariables(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const agentId = String(this.getNodeParameter('agentId', '', { extractValue: true }) ?? '').trim();
	if (!agentId) return { fields: [] };

	const agent = await ringeeRequest<RingeeAgent>(this, {
		method: 'GET',
		path: `/v1/ai-voice-agents/${encodeURIComponent(agentId)}`,
		subject: 'AI voice agent',
	});

	const fields: ResourceMapperField[] = (agent.variables ?? []).map((variable) => ({
		id: variable.key,
		displayName: variable.label || variable.key,
		required: variable.required,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		type: 'string',
	}));
	return { fields };
}
