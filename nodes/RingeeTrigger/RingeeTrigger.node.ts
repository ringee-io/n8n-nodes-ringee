import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { getAgents } from '../Ringee/methods/listSearch';
import { RINGEE_EVENTS, RINGEE_TEST_EVENT, type RingeeWebhookEnvelope } from '../../lib/types';
import { markEventSeen, type SeenEvents } from '../../lib/utils/dedupe';
import { DEFAULT_TOLERANCE_SECONDS, verifyRingeeSignature } from '../../lib/utils/webhook';

interface TriggerOptions {
	onlyAiAgentCalls?: boolean;
	agentId?: { value?: string } | string;
	externalIdPrefix?: string;
	maxAgeSeconds?: number;
	ignoreDuplicates?: boolean;
}

export class RingeeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ringee Trigger',
		name: 'ringeeTrigger',
		icon: { light: 'file:../Ringee/ringee.svg', dark: 'file:../Ringee/ringee.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{ ($parameter["events"] || []).join(", ") }}',
		description:
			'Starts the workflow when something happens in Ringee, such as a call ending or an AI voice agent delivering its result',
		defaults: { name: 'Ringee Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ringeeApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: 'noData',
				path: 'webhook',
			},
		],
		triggerPanel: {
			header: 'Listen for Ringee events',
			executionsHelp: {
				inactive:
					'Webhooks have two modes: test and production. Use the test URL while building: choose “Listen for test event”, then send a test event from Ringee. Use the production URL once the workflow is active.',
				active:
					'Webhooks have two modes: test and production. The production URL is live while the workflow is active. Executions appear in the Executions tab.',
			},
			activationHint:
				'Once you have finished building the workflow, activate it, then paste its production URL into your Ringee Custom Integration as the Outbound URL.',
		},
		properties: [
			{
				displayName:
					'Setup (once): open Integrations → Custom Integrations in Ringee. Paste this node’s Production URL as the Outbound URL, tick the events you want, and copy the integration’s Signing Secret into your Ringee API credential. Ringee must be able to reach your n8n over HTTPS.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['call.completed'],
				description:
					'The events that start the workflow. Other events Ringee sends to the same URL are acknowledged and ignored.',
				options: RINGEE_EVENTS.map((event) => ({
					name: event.name,
					value: event.value,
					description: event.description,
				})),
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'AI Voice Agent',
						name: 'agentId',
						type: 'resourceLocator',
						default: { mode: 'list', value: '' },
						description: 'Only events from calls this AI voice agent made',
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
							},
						],
					},
					{
						displayName: 'External ID Starts With',
						name: 'externalIdPrefix',
						type: 'string',
						default: '',
						placeholder: 'e.g. reminder-',
						description:
							'Only events whose call was started with an External ID that begins with this text. Ringee sends every event to the Outbound URL of each Custom Integration in the workspace, so use one Custom Integration per workflow and this filter to make each workflow handle only its own calls.',
					},
					{
						displayName: 'Ignore Duplicate Events',
						name: 'ignoreDuplicates',
						type: 'boolean',
						default: true,
						description:
							'Whether to skip an event Ringee sends again after it was already received. Ringee repeats an event when it did not get an answer in time, with the same event ID.',
					},
					{
						displayName: 'Maximum Event Age (Seconds)',
						name: 'maxAgeSeconds',
						type: 'number',
						default: DEFAULT_TOLERANCE_SECONDS,
						typeOptions: { minValue: 30, maxValue: 3600 },
						description:
							'Reject a delivery whose signature is older than this. Protects against someone replaying a captured request.',
					},
					{
						displayName: 'Only AI Voice Agent Calls',
						name: 'onlyAiAgentCalls',
						type: 'boolean',
						default: false,
						description:
							'Whether to react only to events about calls an AI voice agent made, not calls people made themselves',
					},
				],
			},
		],
	};

	methods = {
		listSearch: { getAgents },
	};

	/**
	 * Ringee has no per-workflow registration: events go to the Outbound URL the
	 * user sets on a Custom Integration, so there is nothing to create or remove
	 * on Ringee's side. What this lifecycle does instead is refuse to activate a
	 * trigger that could only reject events — without the signing secret every
	 * delivery fails verification — so the mistake shows up when the workflow is
	 * switched on, not as silence later.
	 */
	webhookMethods = {
		default: {
			// Always "not registered yet", so that `create` runs on every activation.
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('ringeeApi');
				const secret =
					typeof credentials.signingSecret === 'string' ? credentials.signingSecret.trim() : '';
				if (!secret) {
					throw new NodeOperationError(
						this.getNode(),
						'The Ringee API credential has no Webhook Signing Secret',
						{
							description:
								'Open the Custom Integration in Ringee, copy its Signing Secret (it starts with whsec_) into the credential, and activate the workflow again. Without it every event would be rejected.',
						},
					);
				}
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		const response = this.getResponseObject();
		const reject = (status: number, message: string): IWebhookResponseData => {
			response.status(status).json({ message });
			return { noWebhookResponse: true };
		};

		const options = this.getNodeParameter('options', {}) as TriggerOptions;
		const credentials = await this.getCredentials('ringeeApi');
		const secret =
			typeof credentials.signingSecret === 'string' ? credentials.signingSecret : undefined;

		// Nothing is read from the body until the signature over its exact bytes
		// is proven; without the secret, nothing is ever accepted.
		const rawBody = (request as { rawBody?: Buffer }).rawBody;
		if (!rawBody) return reject(400, 'The request body could not be read');

		const verdict = verifyRingeeSignature({
			rawBody,
			secret,
			signatureHeader: headerOf(request.headers['ringee-signature']),
			toleranceSeconds: options.maxAgeSeconds ?? DEFAULT_TOLERANCE_SECONDS,
		});
		if (!verdict.ok) {
			return reject(
				401,
				verdict.reason === 'missing_secret'
					? 'No Webhook Signing Secret is set in the Ringee API credential'
					: `The signature was not accepted (${verdict.reason})`,
			);
		}

		const body = this.getBodyData() as unknown as Partial<RingeeWebhookEnvelope>;
		if (typeof body?.event !== 'string' || typeof body.eventId !== 'string' || !body.data) {
			return reject(400, 'The request is not a Ringee event');
		}
		const event = body as RingeeWebhookEnvelope;

		// Ringee's “Send test” button: shown while building, never run in production.
		if (event.event === RINGEE_TEST_EVENT) {
			if (this.getMode() === 'manual') return emit(event);
			return acknowledge('test event received');
		}

		const selected = this.getNodeParameter('events', []) as string[];
		if (!selected.includes(event.event)) return acknowledge('event ignored');
		if (!matchesFilters(event, options)) return acknowledge('event filtered out');

		if (options.ignoreDuplicates !== false) {
			const staticData = this.getWorkflowStaticData('node') as { seen?: SeenEvents };
			const { duplicate, seen } = markEventSeen(staticData.seen ?? {}, event.eventId);
			staticData.seen = seen;
			if (duplicate) return acknowledge('duplicate event');
		}

		return emit(event);

		function emit(payload: RingeeWebhookEnvelope): IWebhookResponseData {
			return { workflowData: [[{ json: payload as unknown as IDataObject }]] };
		}
	}
}

/** The event was received and verified; there is just nothing for the workflow to do. */
function acknowledge(message: string): IWebhookResponseData {
	return { webhookResponse: { received: true, message } };
}

function headerOf(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

export function matchesFilters(event: RingeeWebhookEnvelope, options: TriggerOptions): boolean {
	const agent = event.data.agent;
	if (options.onlyAiAgentCalls && !agent) return false;

	const wantedAgent =
		typeof options.agentId === 'string' ? options.agentId : (options.agentId?.value ?? '');
	if (wantedAgent.trim() && agent?.id !== wantedAgent.trim()) return false;

	const prefix = options.externalIdPrefix?.trim();
	if (prefix) {
		const externalId = event.data.externalId;
		if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) return false;
	}
	return true;
}
