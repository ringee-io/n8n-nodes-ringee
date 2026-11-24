import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ringeeRequest, ringeeRequestAllItems } from '../../../../lib/api/client';
import type { RingeeContact } from '../../../../lib/types';
import { cleanPhoneNumber } from '../../../../lib/utils/phone';
import { contactLocator, forOperation, paging } from '../../shared/fields';
import { locatorValue, textValue, toItems, withoutEmpty } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'contact';

const operationOptions: NonNullable<INodeProperties['options']> = [
	{
		name: 'Create',
		value: 'create',
		description: 'Create a new contact. Fails if the phone number already has one.',
		action: 'Create a contact',
	},
	{
		name: 'Create or Update',
		value: 'createOrUpdate',
		description: 'Create a new contact or update the one that has this phone number (upsert)',
		action: 'Create or update a contact',
	},
	{
		name: 'Get',
		value: 'get',
		description: 'Retrieve a contact',
		action: 'Get a contact',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		description: 'Retrieve a list of contacts',
		action: 'Get many contacts',
	},
	{
		name: 'Update',
		value: 'update',
		description: 'Update a contact',
		action: 'Update a contact',
	},
];

const deleteOption = {
	name: 'Delete',
	value: 'delete',
	description: 'Delete a contact permanently from the contact list',
	action: 'Delete a contact',
};

/** Fields shared by create, create-or-update and update. */
const contactFields = (includePhone: boolean): INodeProperties[] => [
	...(includePhone
		? [
				{
					displayName: 'Phone Number',
					name: 'phoneNumber',
					type: 'string',
					default: '',
					placeholder: 'e.g. +14155550123',
					description: 'The number of the contact, in international format',
				} as INodeProperties,
			]
		: []),
	{
		displayName: 'Company',
		name: 'organization',
		type: 'string',
		default: '',
		description: 'The company the contact works for',
	},
	{
		displayName: 'Company Size',
		name: 'companySize',
		type: 'string',
		default: '',
		placeholder: 'e.g. 11-50',
	},
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
	},
	{
		displayName: 'First Name',
		name: 'firstName',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Job Title',
		name: 'jobTitle',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Last Name',
		name: 'lastName',
		type: 'string',
		default: '',
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		description: 'The full name, as it should be shown. Leave empty to use first and last name.',
	},
	{
		displayName: 'Revenue',
		name: 'revenue',
		type: 'string',
		default: '',
		placeholder: 'e.g. $1M-$5M',
	},
	{
		displayName: 'Source',
		name: 'source',
		type: 'string',
		default: '',
		placeholder: 'e.g. n8n',
		description: 'Where the contact came from',
	},
	{
		displayName: 'State',
		name: 'state',
		type: 'string',
		default: '',
		description: 'State or region',
	},
	{
		displayName: 'Website',
		name: 'website',
		type: 'string',
		default: '',
		placeholder: 'e.g. https://example.com',
	},
];

const noteField: INodeProperties = {
	displayName: 'Note',
	name: 'note',
	type: 'string',
	typeOptions: { rows: 3 },
	default: '',
	description:
		'A first note to save on the contact. It is saved when the contact is created, never again on later updates.',
};

const description: INodeProperties[] = [
	// The operation list differs in AI tool mode: a destructive operation is
	// never offered to an AI agent by default.
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE], '@tool': [false] } },
		default: 'getMany',
		options: [...operationOptions, deleteOption].sort((a, b) =>
			String(a.name).localeCompare(String(b.name)),
		),
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [RESOURCE], '@tool': [true] } },
		default: 'getMany',
		options: operationOptions,
	},

	// ── Create / Create or Update ─────────────────────────────────────────
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. +14155550123',
		description: 'The number of the contact, in international format',
		displayOptions: forOperation(RESOURCE, ['create', 'createOrUpdate']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: forOperation(RESOURCE, ['create', 'createOrUpdate']),
		options: [...contactFields(false), noteField],
	},

	// ── Get / Update / Delete ─────────────────────────────────────────────
	contactLocator(forOperation(RESOURCE, ['get', 'update', 'delete'])),
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: forOperation(RESOURCE, ['update']),
		options: contactFields(true),
	},
	{
		displayName: 'Confirm Phone Number',
		name: 'confirmPhoneNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. +14155550123',
		description:
			"The contact's own phone number, to confirm that you mean to delete this contact. Read it from the contact first, for example with an expression.",
		displayOptions: forOperation(RESOURCE, ['delete']),
	},

	// ── Get Many ──────────────────────────────────────────────────────────
	...paging(forOperation(RESOURCE, ['getMany'])),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: forOperation(RESOURCE, ['getMany']),
		options: [
			{
				displayName: 'Search',
				name: 'query',
				type: 'string',
				default: '',
				placeholder: 'e.g. +1415 or Ada',
				description:
					'Only contacts whose name, phone number, email, company, job title, state or website contain this text',
			},
		],
	},
];

const create: OperationHandler = async (ctx, itemIndex) => {
	const contact = await ringeeRequest<RingeeContact>(ctx, {
		method: 'POST',
		path: '/v1/contacts',
		body: readContactBody(ctx, itemIndex, 'additionalFields'),
		itemIndex,
		subject: 'contact',
	});
	return toItems(contact as unknown as IDataObject, itemIndex);
};

const createOrUpdate: OperationHandler = async (ctx, itemIndex) => {
	const contact = await ringeeRequest<RingeeContact & { created: boolean }>(ctx, {
		method: 'PUT',
		path: '/v1/contacts',
		body: readContactBody(ctx, itemIndex, 'additionalFields'),
		itemIndex,
		subject: 'contact',
	});
	return toItems(contact as unknown as IDataObject, itemIndex);
};

const get: OperationHandler = async (ctx, itemIndex) => {
	const contactId = locatorValue(ctx, 'contactId', itemIndex);
	const contact = await ringeeRequest<RingeeContact>(ctx, {
		method: 'GET',
		path: `/v1/contacts/${encodeURIComponent(contactId)}`,
		itemIndex,
		subject: 'contact',
	});
	return toItems(contact as unknown as IDataObject, itemIndex);
};

const getMany: OperationHandler = async (ctx, itemIndex) => {
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = ctx.getNodeParameter('limit', itemIndex, 50) as number;
	const filters = ctx.getNodeParameter('filters', itemIndex, {}) as { query?: string };

	const contacts = await ringeeRequestAllItems<RingeeContact>(
		ctx,
		{
			method: 'GET',
			path: '/v1/contacts',
			qs: withoutEmpty({ query: filters.query }),
			itemIndex,
			subject: 'contact',
		},
		{ returnAll, limit },
	);
	return toItems(contacts as unknown as IDataObject[], itemIndex);
};

const update: OperationHandler = async (ctx, itemIndex) => {
	const contactId = locatorValue(ctx, 'contactId', itemIndex);
	const fields = ctx.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
	if (Object.keys(withoutEmpty(fields)).length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Add at least one field to update', {
			itemIndex,
			description: "Use 'Add Field' under 'Update Fields' to choose what to change.",
		});
	}
	const body = withoutEmpty(fields);
	if (typeof body.phoneNumber === 'string') {
		const phone = cleanPhoneNumber(body.phoneNumber);
		if (!phone.value) {
			throw new NodeOperationError(ctx.getNode(), phone.problem ?? 'Invalid phone number.', {
				itemIndex,
			});
		}
		body.phoneNumber = phone.value;
	}
	const contact = await ringeeRequest<RingeeContact>(ctx, {
		method: 'PATCH',
		path: `/v1/contacts/${encodeURIComponent(contactId)}`,
		body,
		itemIndex,
		subject: 'contact',
	});
	return toItems(contact as unknown as IDataObject, itemIndex);
};

const del: OperationHandler = async (ctx, itemIndex) => {
	const contactId = locatorValue(ctx, 'contactId', itemIndex);
	const confirmPhoneNumber = textValue(ctx, 'confirmPhoneNumber', itemIndex);
	if (!confirmPhoneNumber) {
		throw new NodeOperationError(ctx.getNode(), 'Enter the contact’s phone number to confirm', {
			itemIndex,
			description:
				"Fill 'Confirm Phone Number' with the number of the contact you are deleting. Ringee refuses to delete without it.",
		});
	}
	const result = await ringeeRequest<{ deleted: boolean; id: string }>(ctx, {
		method: 'DELETE',
		path: `/v1/contacts/${encodeURIComponent(contactId)}`,
		qs: { confirm_phone_number: confirmPhoneNumber },
		itemIndex,
		subject: 'contact',
	});
	return toItems({ deleted: result.deleted, id: result.id }, itemIndex);
};

function readContactBody(
	ctx: Parameters<OperationHandler>[0],
	itemIndex: number,
	collection: string,
): IDataObject {
	const phone = cleanPhoneNumber(ctx.getNodeParameter('phoneNumber', itemIndex, ''));
	if (!phone.value) {
		throw new NodeOperationError(ctx.getNode(), phone.problem ?? 'Enter the phone number.', {
			itemIndex,
			description: "Fix the 'Phone Number' field.",
		});
	}
	const extra = ctx.getNodeParameter(collection, itemIndex, {}) as IDataObject;
	return { phoneNumber: phone.value, ...withoutEmpty(extra) };
}

export const contact: ResourceModule = {
	description,
	operations: { create, createOrUpdate, get, getMany, update, delete: del },
};
