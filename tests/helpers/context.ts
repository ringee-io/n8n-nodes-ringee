import type {
	IBinaryData,
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
} from 'n8n-workflow';
import { MOCK_API_KEY } from './mock-ringee';

export interface ContextOptions {
	baseUrl: string;
	/** Parameters by name; a function is called with the item index. */
	params?: Record<string, unknown | ((itemIndex: number) => unknown)>;
	items?: INodeExecutionData[];
	apiKey?: string;
	signingSecret?: string;
	continueOnFail?: boolean;
	workflowId?: string;
	executionId?: string | undefined;
	nodeId?: string;
	runIndex?: number;
	/** `n8n-nodes-ringee.ringeeTool` runs the node as an AI agent's tool. */
	nodeType?: string;
}

/**
 * A stand-in for the n8n context a node runs in, wired to a real HTTP server.
 * `httpRequestWithAuthentication` behaves as n8n's does for this credential: it
 * adds the API key header, honors `disableFollowRedirect` and
 * `ignoreHttpStatusErrors`, and returns `{ statusCode, headers, body }` when
 * asked for the full response.
 */
export function makeContext(options: ContextOptions) {
	const items = options.items ?? [{ json: {} }];
	const calls: Array<{ credential: string; options: IHttpRequestOptions }> = [];

	const fetchWithAuth = async (credential: string, request: IHttpRequestOptions) => {
		calls.push({ credential, options: request });
		const url = new URL(request.url);
		for (const [key, value] of Object.entries(request.qs ?? {})) {
			if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
		}
		const headers: Record<string, string> = {
			...(request.headers as Record<string, string>),
			'X-Ringee-Api-Key': options.apiKey ?? MOCK_API_KEY,
		};
		if (request.body !== undefined) headers['Content-Type'] = 'application/json';

		const response = await fetch(url, {
			method: request.method ?? 'GET',
			headers,
			body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
			redirect: request.disableFollowRedirect ? 'manual' : 'follow',
			signal: AbortSignal.timeout(request.timeout ?? 30_000),
		});

		let body: unknown;
		if (request.encoding === 'arraybuffer') {
			body = Buffer.from(await response.arrayBuffer());
		} else {
			const text = await response.text();
			try {
				body = text ? JSON.parse(text) : undefined;
			} catch {
				body = text;
			}
		}
		if (!request.ignoreHttpStatusErrors && !response.ok) {
			throw Object.assign(new Error(`HTTP ${response.status}`), {
				httpCode: String(response.status),
			});
		}
		return request.returnFullResponse
			? {
					statusCode: response.status,
					headers: Object.fromEntries(response.headers.entries()),
					body,
				}
			: body;
	};

	const context = {
		getInputData: () => items,
		getNodeParameter: (
			name: string,
			itemIndex: number,
			fallback?: unknown,
			extra?: { extractValue?: boolean },
		) => {
			const raw = options.params?.[name];
			let value = typeof raw === 'function' ? (raw as (i: number) => unknown)(itemIndex) : raw;
			if (value === undefined) value = fallback;
			if (
				extra?.extractValue &&
				value &&
				typeof value === 'object' &&
				'value' in (value as object) &&
				'mode' in (value as object)
			) {
				value = (value as { value: unknown }).value;
			}
			return value;
		},
		getCredentials: async () => ({
			apiKey: options.apiKey ?? MOCK_API_KEY,
			baseUrl: options.baseUrl,
			signingSecret: options.signingSecret ?? '',
		}),
		getNode: () => ({
			id: options.nodeId ?? 'node-1',
			name: 'Ringee',
			type: options.nodeType ?? 'n8n-nodes-ringee.ringee',
			typeVersion: 1,
			position: [0, 0] as [number, number],
			parameters: {},
		}),
		getWorkflow: () => ({ id: options.workflowId ?? 'wf-1', name: 'Test', active: true }),
		getExecutionId: () => {
			if ('executionId' in options && options.executionId === undefined) {
				throw new Error('no execution id');
			}
			return options.executionId ?? 'exec-1';
		},
		evaluateExpression: () => options.runIndex ?? 0,
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: fetchWithAuth,
			prepareBinaryData: async (
				data: Buffer,
				fileName?: string,
				mimeType?: string,
			): Promise<IBinaryData> => ({
				data: data.toString('base64'),
				mimeType: mimeType ?? 'application/octet-stream',
				fileName,
				fileSize: String(data.length),
			}),
		},
	};

	// ILoadOptionsFunctions reads parameters without an item index:
	// getNodeParameter(name, fallback, options).
	const loadContext = {
		...context,
		getNodeParameter: (name: string, fallback?: unknown, extra?: { extractValue?: boolean }) =>
			context.getNodeParameter(name, 0, fallback, extra),
	};

	return {
		ctx: context as unknown as IExecuteFunctions,
		loadCtx: loadContext as unknown as ILoadOptionsFunctions,
		calls,
	};
}

export function jsonOf(items: INodeExecutionData[]): IDataObject[] {
	return items.map((item) => item.json);
}

/**
 * For `promise.then(unexpectedSuccess, (error) => error as NodeApiError)`: the
 * result is typed as the error, and a promise that resolves fails the test.
 */
export function unexpectedSuccess(): never {
	throw new Error('Expected the call to be refused, but it succeeded');
}
