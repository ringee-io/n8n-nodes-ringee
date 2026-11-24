import type {
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';
import { ringeeRequest } from '../../../lib/api/client';
import type {
	RingeeAgentList,
	RingeeCallerNumber,
	RingeeContact,
	RingeePage,
} from '../../../lib/types';

/** AI voice agents of the workspace, narrowed by what was typed in the box. */
export async function getAgents(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const page = await ringeeRequest<RingeeAgentList>(this, {
		method: 'GET',
		path: '/v1/ai-voice-agents',
		qs: { limit: 100 },
	});
	const needle = (filter ?? '').trim().toLowerCase();
	const results: INodeListSearchItems[] = (page.data ?? [])
		// A receptionist answers calls; it cannot place one.
		.filter((agent) => agent.type !== 'receptionist')
		.filter((agent) => !needle || agent.name.toLowerCase().includes(needle))
		.map((agent) => ({
			name: agent.name,
			value: agent.id,
			description: `${agent.type.replace(/_/g, ' ')}${agent.status !== 'active' ? ` · ${agent.status}` : ''}`,
		}));
	return { results };
}

/** Numbers an AI voice agent may call from. */
export async function getCallerNumbers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const numbers = await ringeeRequest<RingeeCallerNumber[]>(this, {
		method: 'GET',
		path: '/v1/ai-voice-agents/phone-numbers',
	});
	const needle = (filter ?? '').replace(/\s+/g, '');
	const results: INodeListSearchItems[] = (Array.isArray(numbers) ? numbers : [])
		.filter((number) => !needle || number.phoneNumber.includes(needle))
		.map((number) => ({
			name: number.phoneNumber,
			value: number.id,
			description: [number.isoCountry, number.kind?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
		}));
	return { results };
}

/** Contacts of the workspace, a page at a time as the dropdown scrolls. */
export async function getContacts(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const page = Number(paginationToken) || 1;
	const response = await ringeeRequest<RingeePage<RingeeContact> & { totalPages: number }>(this, {
		method: 'GET',
		path: '/v1/contacts',
		qs: { query: filter?.trim() || undefined, page, limit: 50 },
	});
	const results: INodeListSearchItems[] = (response.data ?? []).map((contact) => ({
		name: displayName(contact),
		value: contact.id,
		description: contact.phoneNumber,
	}));
	const hasMore = response.totalPages !== undefined && page < response.totalPages;
	return { results, paginationToken: hasMore ? String(page + 1) : undefined };
}

function displayName(contact: RingeeContact): string {
	const name =
		contact.name ||
		[contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
		contact.email ||
		contact.phoneNumber;
	return name;
}
