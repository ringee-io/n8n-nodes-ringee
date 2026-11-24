import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { getAgentVariables } from './methods/resourceMapping';
import { getAgents, getCallerNumbers, getContacts } from './methods/listSearch';
import { RESOURCES, RESOURCE_OPTIONS } from './resources';

export class Ringee implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Ringee',
		name: 'ringee',
		icon: { light: 'file:ringee.svg', dark: 'file:ringee.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Make AI phone calls, read call results and transcripts, and manage contacts with Ringee',
		defaults: { name: 'Ringee' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ringeeApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: RESOURCE_OPTIONS,
				default: 'aiAgent',
			},
			...Object.values(RESOURCES).flatMap((resource) => resource.description),
		],
	};

	methods = {
		listSearch: { getAgents, getCallerNumbers, getContacts },
		resourceMapping: { getAgentVariables },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		const handler = RESOURCES[resource]?.operations[operation];
		if (!handler) {
			throw new NodeOperationError(
				this.getNode(),
				`The operation '${operation}' is not available for '${resource}'`,
				{ description: 'Pick one of the operations in the list.' },
			);
		}

		const returnData: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				returnData.push(...(await handler(this, itemIndex)));
			} catch (error) {
				// Each output stays linked to the item that produced it, so a failed
				// item never shifts the results of the ones after it.
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				// Wrapping an error of the same class returns it as it was, so what
				// Ringee said is kept; only the item it belongs to is added.
				if (error instanceof NodeApiError) {
					error.context.itemIndex ??= itemIndex;
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				}
				if (error instanceof NodeOperationError) {
					error.context.itemIndex ??= itemIndex;
					throw new NodeOperationError(this.getNode(), error);
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return [returnData];
	}
}
