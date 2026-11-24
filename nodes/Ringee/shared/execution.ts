import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

/** The value of a resource locator, whichever mode it was filled in with. */
export function locatorValue(
	ctx: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback = '',
): string {
	const value = ctx.getNodeParameter(name, itemIndex, fallback, { extractValue: true });
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

/** A string parameter, trimmed. */
export function textValue(ctx: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = ctx.getNodeParameter(name, itemIndex, '') as unknown;
	return typeof value === 'string' ? value.trim() : '';
}

/** JSON objects become items, arrays become several, each paired with its input. */
export function toItems(
	json: IDataObject | IDataObject[],
	itemIndex: number,
): INodeExecutionData[] {
	const list = Array.isArray(json) ? json : [json];
	return list.map((entry) => ({ json: entry, pairedItem: { item: itemIndex } }));
}

/** Drops keys whose value is empty, so an optional field is omitted, not blanked. */
export function withoutEmpty<T extends IDataObject>(input: T): IDataObject {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => {
			if (value === undefined || value === null) return false;
			if (typeof value === 'string') return value.trim() !== '';
			return true;
		}),
	);
}
