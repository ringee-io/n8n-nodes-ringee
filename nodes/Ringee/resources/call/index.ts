import type { IDataObject, INodeProperties } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { ringeeRequest, ringeeRequestAllItems } from '../../../../lib/api/client';
import { CALL_OUTCOMES, CALL_STATUSES, type RingeeCallSummary } from '../../../../lib/types';
import { cleanPhoneNumber } from '../../../../lib/utils/phone';
import { callIdField, forOperation, paging } from '../../shared/fields';
import { simplifyCall, fetchCallDetail } from '../../shared/call-detail';
import { toItems, withoutEmpty } from '../../shared/execution';
import type { OperationHandler, ResourceModule } from '../types';

const RESOURCE = 'call';

const titleCase = (value: string) =>
	value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

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
				name: 'Create Dialer Link',
				value: 'createDialerLink',
				description:
					'Create a link that opens the Ringee dialer ready to call a number. A person opens it and presses call.',
				action: 'Create a dialer link for a human call',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Retrieve a call with its outcome, transcript, recording and AI analysis',
				action: 'Get a call',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Retrieve a list of calls, newest first',
				action: 'Get many calls',
			},
		],
	},

	// ── Get ───────────────────────────────────────────────────────────────
	callIdField(forOperation(RESOURCE, ['get'])),
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return a simplified version of the response instead of the raw data. Turn it off to include the full transcript segments, meetings and callbacks.',
		displayOptions: forOperation(RESOURCE, ['get']),
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
				displayName: 'Contact ID',
				name: 'contactId',
				type: 'string',
				default: '',
				description: 'Only calls with this contact',
			},
			{
				displayName: 'From',
				name: 'dateFrom',
				type: 'dateTime',
				default: '',
				description: 'Only calls created at or after this time',
			},
			{
				displayName: 'Outcome',
				name: 'outcome',
				type: 'options',
				default: 'meeting_booked',
				description: 'Only calls recorded with this outcome',
				options: CALL_OUTCOMES.map((value) => ({ name: titleCase(value), value })),
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'completed',
				description: 'Only calls in this status',
				options: CALL_STATUSES.map((value) => ({ name: titleCase(value), value })),
			},
			{
				displayName: 'To',
				name: 'dateTo',
				type: 'dateTime',
				default: '',
				description: 'Only calls created at or before this time',
			},
		],
	},

	// ── Create Dialer Link ────────────────────────────────────────────────
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. +14155550123',
		description: 'The number the person will call, in international format',
		displayOptions: forOperation(RESOURCE, ['createDialerLink']),
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: forOperation(RESOURCE, ['createDialerLink']),
		options: [
			{
				displayName: 'Agent Email',
				name: 'agentEmail',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
				description:
					'The team member who will place the call. Required in an organization workspace; a personal workspace always uses its owner.',
			},
			{
				displayName: 'Caller Number',
				name: 'fromNumber',
				type: 'string',
				default: '',
				placeholder: 'e.g. +14155550100',
				description:
					'The number to show to the person. Leave empty to use the first verified caller ID or purchased number.',
			},
		],
	},
];

const get: OperationHandler = async (ctx, itemIndex) => {
	const { call } = await fetchCallDetail(ctx, itemIndex);
	const simplify = ctx.getNodeParameter('simplify', itemIndex, true) as boolean;
	return toItems(simplify ? simplifyCall(call) : (call as unknown as IDataObject), itemIndex);
};

const getMany: OperationHandler = async (ctx, itemIndex) => {
	const returnAll = ctx.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = ctx.getNodeParameter('limit', itemIndex, 50) as number;
	const filters = ctx.getNodeParameter('filters', itemIndex, {}) as IDataObject;

	const calls = await ringeeRequestAllItems<RingeeCallSummary>(
		ctx,
		{
			method: 'GET',
			path: '/v1/calls',
			qs: withoutEmpty({
				contact_id: filters.contactId,
				outcome: filters.outcome,
				status: filters.status,
				date_from: toIso(filters.dateFrom),
				date_to: toIso(filters.dateTo),
			}),
			itemIndex,
			subject: 'call',
		},
		{ returnAll, limit },
	);
	return toItems(calls as unknown as IDataObject[], itemIndex);
};

const createDialerLink: OperationHandler = async (ctx, itemIndex) => {
	const phone = cleanPhoneNumber(ctx.getNodeParameter('phoneNumber', itemIndex, ''));
	if (!phone.value) {
		throw new NodeOperationError(ctx.getNode(), phone.problem ?? 'Enter the phone number.', {
			itemIndex,
			description: "Fix the 'Phone Number' field.",
		});
	}
	const options = ctx.getNodeParameter('options', itemIndex, {}) as {
		agentEmail?: string;
		fromNumber?: string;
	};
	const link = await ringeeRequest<{
		dialerUrl: string;
		expiresAt: string;
		toNumber: string;
		fromNumber: string;
		contactId: string | null;
		agentUserId: string;
	}>(ctx, {
		method: 'POST',
		path: '/integrations/custom/click-to-call',
		body: withoutEmpty({
			phoneNumber: phone.value,
			agentEmail: options.agentEmail,
			fromNumber: options.fromNumber,
		}),
		itemIndex,
		subject: 'contact',
	});
	// The link is a bearer credential for five minutes: only what a workflow
	// needs is returned.
	return toItems(
		{
			dialerUrl: link.dialerUrl,
			expiresAt: link.expiresAt,
			toNumber: link.toNumber,
			fromNumber: link.fromNumber,
			contactId: link.contactId,
		},
		itemIndex,
	);
};

function toIso(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.trim() === '') return undefined;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export const call: ResourceModule = {
	description,
	operations: { get, getMany, createDialerLink },
};
