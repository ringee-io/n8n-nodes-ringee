import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

export const UUID_REGEX =
	'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

/** `displayOptions` that show a property for one operation of one resource. */
export function forOperation(resource: string, operations: string[]): IDisplayOptions {
	return { show: { resource: [resource], operation: operations } };
}

const idValidation: NonNullable<INodeProperties['modes']>[number]['validation'] = [
	{
		type: 'regex',
		properties: {
			regex: UUID_REGEX,
			errorMessage: 'Not a valid Ringee ID. It looks like 123e4567-e89b-42d3-a456-426614174000',
		},
	},
];

/** The AI voice agent to use, picked from the workspace's agents or given by ID. */
export function agentLocator(
	displayOptions: IDisplayOptions,
	overrides: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName: 'AI Voice Agent',
		name: 'agentId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The AI voice agent that makes the call',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select an AI voice agent…',
				typeOptions: { searchListMethod: 'getAgents', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 123e4567-e89b-42d3-a456-426614174000',
				validation: idValidation,
			},
		],
		...overrides,
	};
}

/** A contact, picked from the workspace's contacts or given by ID. */
export function contactLocator(
	displayOptions: IDisplayOptions,
	overrides: Partial<INodeProperties> = {},
): INodeProperties {
	return {
		displayName: 'Contact',
		name: 'contactId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The contact to use',
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Select a contact…',
				typeOptions: { searchListMethod: 'getContacts', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 123e4567-e89b-42d3-a456-426614174000',
				validation: idValidation,
			},
		],
		...overrides,
	};
}

/**
 * The call to read. It takes the ID an event carries (`data.callId`) and the one
 * Start Call returns (`call_id`) alike, so a workflow can pass either along.
 */
export function callIdField(displayOptions: IDisplayOptions): INodeProperties {
	return {
		displayName: 'Call ID',
		name: 'callId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 123e4567-e89b-42d3-a456-426614174000',
		description:
			'The call to read. Use the call_id that Start Call returned, or the call ID from a Ringee Trigger event. Either works.',
		displayOptions,
	};
}

/** "Return All" and "Limit" for a Get Many operation. */
export function paging(displayOptions: IDisplayOptions): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			description: 'Whether to return all results or only up to a given limit',
			displayOptions,
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			description: 'Max number of results to return',
			displayOptions: {
				show: { ...displayOptions.show, returnAll: [false] },
			},
		},
	];
}
