import type { IExecuteFunctions, INodeExecutionData, INodeProperties } from 'n8n-workflow';

/** Runs one operation for one input item and returns the items it produces. */
export type OperationHandler = (
	ctx: IExecuteFunctions,
	itemIndex: number,
) => Promise<INodeExecutionData[]>;

/** A resource of the Ringee node: its parameters and what each operation does. */
export interface ResourceModule {
	description: INodeProperties[];
	operations: Record<string, OperationHandler>;
}
