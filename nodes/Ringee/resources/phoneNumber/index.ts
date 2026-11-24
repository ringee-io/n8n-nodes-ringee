import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ringeeRequest } from '../../../../lib/api/client';
import type { RingeeCallerNumber } from '../../../../lib/types';
import { forOperation, UUID_REGEX } from '../../shared/fields';
import { locatorValue, toItems } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'phoneNumber';

const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE] } },
		default: 'getMany',
		options: [
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve one of the numbers an AI voice agent can call from',
				action: 'Get a phone number',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Retrieve the numbers an AI voice agent can call from',
				action: 'Get many phone numbers',
			},
		],
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumberId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'The number to retrieve',
		displayOptions: forOperation(RESOURCE, ['get']),
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
				validation: [
					{
						type: 'regex',
						properties: { regex: UUID_REGEX, errorMessage: 'Not a valid Ringee ID.' },
					},
				],
			},
		],
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: forOperation(RESOURCE, ['getMany']),
		options: [
			{
				displayName: 'Kind',
				name: 'kind',
				type: 'options',
				default: 'purchased',
				description: 'Only numbers bought in Ringee, or only caller IDs you verified',
				options: [
					{ name: 'Purchased Number', value: 'purchased' },
					{ name: 'Verified Caller ID', value: 'verified_caller_id' },
				],
			},
		],
	},
];

async function listNumbers(ctx: Parameters<OperationHandler>[0], itemIndex: number) {
	return ringeeRequest<RingeeCallerNumber[]>(ctx, {
		method: 'GET',
		path: '/v1/ai-voice-agents/phone-numbers',
		itemIndex,
		subject: 'phone number',
	});
}

const getMany: OperationHandler = async (ctx, itemIndex) => {
	const filters = ctx.getNodeParameter('filters', itemIndex, {}) as { kind?: string };
	const numbers = await listNumbers(ctx, itemIndex);
	const wanted = (Array.isArray(numbers) ? numbers : []).filter(
		(number) => !filters.kind || number.kind === filters.kind,
	);
	return toItems(wanted as unknown as IDataObject[], itemIndex);
};

const get: OperationHandler = async (ctx, itemIndex) => {
	const id = locatorValue(ctx, 'phoneNumberId', itemIndex);
	const numbers = await listNumbers(ctx, itemIndex);
	const found = (Array.isArray(numbers) ? numbers : []).find((number) => number.id === id);
	if (!found) {
		throw new NodeOperationError(ctx.getNode(), 'Phone number not found', {
			itemIndex,
			description:
				'None of the numbers an AI voice agent can call from in this workspace has that ID.',
		});
	}
	return toItems(found as unknown as IDataObject, itemIndex);
};

export const phoneNumber: ResourceModule = {
	description,
	operations: { get, getMany },
};
