/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-dangerous-functions -- tests read the repository files and run its own generator script; tests are never published */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeHelpers } from 'n8n-workflow';
import type { INodeParameters, INodeProperties, INodeTypeDescription } from 'n8n-workflow';
import { Ringee } from '../nodes/Ringee/Ringee.node';
import { RingeeTrigger } from '../nodes/RingeeTrigger/RingeeTrigger.node';
import { RINGEE_EVENTS } from '../lib/types';

const root = join(__dirname, '..');
const workflowDir = join(root, 'workflows');

interface WNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
	credentials?: unknown;
	webhookId?: string;
	onError?: string;
}
interface Workflow {
	name: string;
	nodes: WNode[];
	connections: Record<
		string,
		Record<string, Array<Array<{ node: string; type: string; index: number }>>>
	>;
	pinData?: Record<string, unknown[]>;
	active?: boolean;
}
interface CatalogEntry {
	id: string;
	file: string;
	title: string;
	description: string;
	businessUseCase: string;
	audience: string;
	requiredIntegrations: string[];
	ringeeFeatures: string[];
	credentials: string[];
	prerequisites: string[];
	configuration: string[];
	sampleData: string;
	errorHandling: string;
	expectedResults: string;
	status: Record<string, boolean>;
	publicationStatus: string;
	ringeeLink: string;
}

const catalog = (
	JSON.parse(readFileSync(join(workflowDir, 'catalog.json'), 'utf8')) as {
		templates: CatalogEntry[];
	}
).templates;
const workflows = catalog.map((entry) => ({
	entry,
	workflow: JSON.parse(readFileSync(join(workflowDir, entry.file), 'utf8')) as Workflow,
	raw: readFileSync(join(workflowDir, entry.file), 'utf8'),
}));

/** The n8n nodes the templates use, with the versions they were checked against (n8n 2.x). */
const KNOWN: Record<string, number[]> = {
	'n8n-nodes-ringee.ringee': [1],
	'n8n-nodes-ringee.ringeeTrigger': [1],
	'n8n-nodes-ringee.ringeeTool': [1],
	'n8n-nodes-base.stickyNote': [1],
	'n8n-nodes-base.noOp': [1],
	'n8n-nodes-base.manualTrigger': [1],
	'n8n-nodes-base.scheduleTrigger': [1.3],
	'n8n-nodes-base.webhook': [2.2],
	'n8n-nodes-base.wait': [1, 1.1],
	'n8n-nodes-base.set': [3.5],
	'n8n-nodes-base.if': [2.3],
	'n8n-nodes-base.switch': [3.5],
	'n8n-nodes-base.httpRequest': [4.5],
	'n8n-nodes-base.googleCalendar': [1.3],
	'n8n-nodes-base.googleSheets': [4.7],
	'n8n-nodes-base.googleSheetsTrigger': [1],
	'n8n-nodes-base.hubspot': [2.3],
	'n8n-nodes-base.hubspotTrigger': [1],
	'n8n-nodes-base.facebookLeadAdsTrigger': [1],
	'n8n-nodes-base.highLevel': [2],
	'n8n-nodes-base.slack': [2.7],
	'@n8n/n8n-nodes-langchain.chatTrigger': [1.5],
	'@n8n/n8n-nodes-langchain.agent': [3.1],
	'@n8n/n8n-nodes-langchain.lmChatOpenAi': [1.3],
	'@n8n/n8n-nodes-langchain.memoryBufferWindow': [1.4],
};

const ringee = new Ringee().description;
const ringeeDescriptions: Record<string, INodeTypeDescription> = {
	'n8n-nodes-ringee.ringee': ringee,
	'n8n-nodes-ringee.ringeeTrigger': new RingeeTrigger().description,
	// n8n derives the tool variant from the action node; its name ends in "Tool".
	'n8n-nodes-ringee.ringeeTool': { ...ringee, name: 'ringeeTool' },
};

/** Empty selections are the user's to make; fill them to check what appears after one. */
function fill(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(fill);
	if (value && typeof value === 'object') {
		const object = value as Record<string, unknown>;
		if (object.__rl && object.value === '') return { ...object, value: 'PLACEHOLDER' };
		return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, fill(v)]));
	}
	return value;
}

/** Keys the node was given that its description does not show for those options. */
function unseenParameters(
	given: Record<string, unknown>,
	kept: Record<string, unknown>,
	properties: INodeProperties[],
	trail = '',
): string[] {
	const problems: string[] = [];
	for (const key of Object.keys(given)) {
		if (!(key in kept)) {
			problems.push(`${trail}${key}`);
			continue;
		}
		const property = properties.find((p) => p.name === key);
		const value = given[key];
		if (
			property?.type === 'collection' &&
			Array.isArray(property.options) &&
			value &&
			typeof value === 'object'
		) {
			problems.push(
				...unseenParameters(
					value as Record<string, unknown>,
					(kept[key] ?? {}) as Record<string, unknown>,
					property.options as INodeProperties[],
					`${trail}${key}.`,
				),
			);
		}
	}
	return problems;
}

const reachable = (
	workflow: Workflow,
	from: string,
	stopAt: (node: WNode) => boolean,
): Set<string> => {
	const byName = new Map(workflow.nodes.map((n) => [n.name, n]));
	const seen = new Set<string>();
	const queue = [from];
	while (queue.length) {
		const name = queue.shift()!;
		for (const group of Object.values(workflow.connections[name] ?? {})) {
			for (const list of group) {
				for (const connection of list ?? []) {
					if (seen.has(connection.node)) continue;
					seen.add(connection.node);
					const node = byName.get(connection.node);
					if (node && !stopAt(node)) queue.push(connection.node);
				}
			}
		}
	}
	return seen;
};

describe('the catalog', () => {
	it('lists every template file, and only files that exist', () => {
		const onDisk = [
			...readdirSync(workflowDir).filter((f) => f.endsWith('.json') && f !== 'catalog.json'),
			...readdirSync(join(workflowDir, 'alternatives')).map((f) => `alternatives/${f}`),
		].sort();
		expect(catalog.map((c) => c.file).sort()).toEqual(onDisk);
		expect(new Set(catalog.map((c) => c.id)).size).toBe(catalog.length);
	});

	it('describes each template completely', () => {
		for (const entry of catalog) {
			for (const field of [
				'title',
				'description',
				'businessUseCase',
				'audience',
				'sampleData',
				'errorHandling',
				'expectedResults',
				'publicationStatus',
			] as const) {
				expect(entry[field], `${entry.id}.${field}`).toBeTruthy();
			}
			for (const field of [
				'requiredIntegrations',
				'ringeeFeatures',
				'credentials',
				'prerequisites',
				'configuration',
			] as const) {
				expect(entry[field].length, `${entry.id}.${field}`).toBeGreaterThan(0);
			}
			expect(entry.ringeeLink).toBe('https://ringee.io');
			// n8n templates are found by search: titles say what they do.
			expect(entry.title.length, entry.id).toBeGreaterThan(30);
		}
	});

	it('does not claim a template was tested with accounts it was not tested with', () => {
		for (const entry of catalog)
			expect(entry.status.testedWithLiveThirdPartyAccounts, entry.id).toBe(false);
	});

	it('has generated documentation that is up to date', () => {
		expect(() =>
			execFileSync(process.execPath, [join(root, 'scripts/build-template-docs.mjs'), '--check'], {
				stdio: 'pipe',
			}),
		).not.toThrow();
	});
});

describe.each(workflows)('template $entry.id', ({ entry, workflow, raw }) => {
	const names = workflow.nodes.map((n) => n.name);

	it('is a well-formed, inactive workflow', () => {
		expect(workflow.name.length).toBeGreaterThan(10);
		expect(workflow.active ?? false).toBe(false);
		expect(new Set(names).size).toBe(names.length);
		expect(new Set(workflow.nodes.map((n) => n.id)).size).toBe(workflow.nodes.length);
		for (const node of workflow.nodes) {
			expect(node.position, node.name).toHaveLength(2);
			expect(node.typeVersion, node.name).toBeGreaterThan(0);
		}
		for (const [from, groups] of Object.entries(workflow.connections)) {
			expect(names, `connection from ${from}`).toContain(from);
			for (const list of Object.values(groups)) {
				for (const outputs of list)
					for (const c of outputs ?? []) expect(names, `${from} → ${c.node}`).toContain(c.node);
			}
		}
		for (const key of Object.keys(workflow.pinData ?? {}))
			expect(names, `pinData for ${key}`).toContain(key);
	});

	it('uses only n8n nodes and versions it was checked against', () => {
		for (const node of workflow.nodes) {
			expect(KNOWN[node.type], `${node.name}: ${node.type}`).toBeDefined();
			expect(KNOWN[node.type], `${node.name}: ${node.type} v${node.typeVersion}`).toContain(
				node.typeVersion,
			);
		}
	});

	it('explains itself: sticky notes, a link to Ringee, a consent reminder', () => {
		const notes = workflow.nodes
			.filter((n) => n.type === 'n8n-nodes-base.stickyNote')
			.map((n) => String(n.parameters.content));
		expect(notes.length).toBeGreaterThanOrEqual(2);
		expect(notes.join('\n')).toContain('https://ringee.io');
		if (entry.id !== 'alt-01-ai-appointment-reminder-http-request')
			expect(notes.join('\n')).toMatch(/Ringee/);
		expect(notes.join('\n').toLowerCase()).toMatch(/consent|agreed to be|permission/);
	});

	it('carries no credentials, secrets or real people', () => {
		expect(workflow.nodes.every((n) => n.credentials === undefined)).toBe(true);
		expect(raw).not.toMatch(/cik_live_[0-9a-f]{20,}/);
		expect(raw).not.toMatch(/whsec_[0-9a-f]{20,}/);
		expect(raw).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
		expect(raw).not.toMatch(/xox[bp]-/);
		// Phone numbers are in the 555-0100…0199 range reserved for fiction.
		for (const number of raw.match(/\+\d{9,}/g) ?? []) {
			expect(number, `${entry.id}: ${number}`).toMatch(/^\+1415555 ?01\d\d$|^\+1415555 ?0\d\d\d$/);
			expect(Number(number.slice(-4)), number).toBeLessThan(200);
		}
	});

	it('gives every webhook-based node its own stable webhook id', () => {
		const hooked = workflow.nodes.filter((n) =>
			[
				'n8n-nodes-base.webhook',
				'n8n-nodes-base.wait',
				'n8n-nodes-ringee.ringeeTrigger',
				'@n8n/n8n-nodes-langchain.chatTrigger',
				'n8n-nodes-base.hubspotTrigger',
			].includes(n.type),
		);
		for (const node of hooked) expect(node.webhookId, node.name).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('gives every Ringee node parameters its description actually shows', () => {
		for (const node of workflow.nodes.filter((n) => n.type in ringeeDescriptions)) {
			const description = ringeeDescriptions[node.type];
			const parameters = fill(node.parameters) as INodeParameters;
			const kept = NodeHelpers.getNodeParameters(
				description.properties,
				parameters,
				true,
				false,
				node as never,
				description,
			) as Record<string, unknown>;
			expect(
				unseenParameters(parameters as Record<string, unknown>, kept, description.properties),
				node.name,
			).toEqual([]);
		}
	});

	it('lets the user choose the agent; the template never hard-codes one', () => {
		for (const node of workflow.nodes.filter((n) => n.parameters.operation === 'startCall')) {
			expect(node.parameters.agentId, node.name).toEqual({ __rl: true, value: '', mode: 'list' });
		}
	});

	it('listens only for events Ringee sends', () => {
		const known = RINGEE_EVENTS.map((e) => e.value) as string[];
		for (const node of workflow.nodes.filter((n) => n.type === 'n8n-nodes-ringee.ringeeTrigger')) {
			for (const event of node.parameters.events as string[])
				expect(known, node.name).toContain(event);
		}
	});

	it('never places a call twice for the same thing', () => {
		for (const node of workflow.nodes.filter(
			(n) => n.parameters.operation === 'startCall' && n.type === 'n8n-nodes-ringee.ringee',
		)) {
			const options = node.parameters.options as Record<string, string>;
			if (entry.id === '00-quick-start-first-ai-call') continue; // a button click: one run, one call
			expect(options.idempotencyKey, `${node.name} needs an idempotency key`).toBeTruthy();
			expect(
				options.externalId,
				`${node.name} needs an external id to find the record again`,
			).toBeTruthy();
		}
		for (const node of workflow.nodes.filter(
			(n) => n.type === 'n8n-nodes-base.httpRequest' && String(n.parameters.method) === 'POST',
		)) {
			expect(JSON.stringify(node.parameters), node.name).toContain('Idempotency-Key');
		}
	});

	it('finds the calls it started: the trigger prefix matches the external id', () => {
		const starters = workflow.nodes.filter(
			(n) => n.parameters.operation === 'startCall' && n.type === 'n8n-nodes-ringee.ringee',
		);
		const triggers = workflow.nodes.filter((n) => n.type === 'n8n-nodes-ringee.ringeeTrigger');
		for (const trigger of triggers) {
			const prefix = (trigger.parameters.options as Record<string, string>).externalIdPrefix;
			if (!prefix || starters.length === 0) continue;
			const matches = starters.some((s) =>
				String((s.parameters.options as Record<string, string>).externalId).includes(`'${prefix}'`),
			);
			expect(matches, `${trigger.name} listens for ${prefix} but no call is started with it`).toBe(
				true,
			);
		}
	});

	it('never reads a call result straight after starting the call', () => {
		const resultReaders = new Set(
			workflow.nodes
				.filter(
					(n) =>
						n.parameters.operation === 'getCallResult' ||
						(n.type === 'n8n-nodes-base.httpRequest' &&
							/ai-voice-agents\/calls\//.test(String(n.parameters.url))),
				)
				.map((n) => n.name),
		);
		for (const starter of workflow.nodes.filter(
			(n) =>
				n.parameters.operation === 'startCall' ||
				(n.type === 'n8n-nodes-base.httpRequest' && String(n.parameters.method) === 'POST'),
		)) {
			// Walk on from the call, but stop at a Wait: whatever lies past it is allowed to read.
			const beforeAnyWait = reachable(
				workflow,
				starter.name,
				(n) => n.type === 'n8n-nodes-base.wait',
			);
			for (const reader of resultReaders) {
				expect(
					beforeAnyWait.has(reader),
					`${reader} runs right after ${starter.name} without waiting`,
				).toBe(false);
			}
		}
	});

	it('never starts a paid call from a webhook that anyone who finds its URL could post to', () => {
		const placesCalls = workflow.nodes.some(
			(n) =>
				n.parameters.operation === 'startCall' ||
				(n.type === 'n8n-nodes-base.httpRequest' &&
					String(n.parameters.method) === 'POST' &&
					/ai-voice-agents\/.+\/calls/.test(String(n.parameters.url))),
		);
		if (!placesCalls) return;
		// A fixed, readable path is not a secret: the template is public.
		for (const hook of workflow.nodes.filter((n) =>
			['n8n-nodes-base.webhook', 'n8n-nodes-base.formTrigger'].includes(n.type),
		)) {
			expect(
				['basicAuth', 'headerAuth', 'jwtAuth'],
				`${hook.name} starts paid calls and needs authentication`,
			).toContain(hook.parameters.authentication);
		}
	});

	it('gives a call that cannot be placed somewhere to go when a batch started it', () => {
		// One rejected number (Do-Not-Call, invalid) must not stop the rest of the
		// batch: the triggers below do not hand the later items over again.
		const batchTriggers = workflow.nodes.filter((n) =>
			[
				'n8n-nodes-base.scheduleTrigger',
				'n8n-nodes-base.googleSheetsTrigger',
				'n8n-nodes-base.hubspotTrigger',
			].includes(n.type),
		);
		for (const trigger of batchTriggers) {
			const downstream = reachable(workflow, trigger.name, () => false);
			for (const node of workflow.nodes.filter(
				(n) =>
					downstream.has(n.name) &&
					n.type === 'n8n-nodes-ringee.ringee' &&
					n.parameters.operation === 'startCall',
			)) {
				expect(node.onError, `${node.name} needs its own error output`).toBe('continueErrorOutput');
				const outputs = workflow.connections[node.name]?.main ?? [];
				expect(outputs[1]?.length ?? 0, `${node.name}: error output goes nowhere`).toBeGreaterThan(
					0,
				);
			}
		}
	});

	it('never acts on a call result before it has checked that the result exists', () => {
		for (const reader of workflow.nodes.filter(
			(n) =>
				n.type === 'n8n-nodes-ringee.ringee' &&
				((n.parameters.resource === 'aiAgent' && n.parameters.operation === 'getCallResult') ||
					(n.parameters.resource === 'transcript' && n.parameters.operation === 'getAnalysis')),
		)) {
			// The last try of a bounded retry may write what it has, labelled as pending.
			if (/second try/i.test(reader.name)) continue;
			const next = (workflow.connections[reader.name]?.main ?? []).flat();
			for (const connection of next) {
				const target = workflow.nodes.find((n) => n.name === connection.node)!;
				expect(
					['n8n-nodes-base.if', 'n8n-nodes-base.switch'],
					`${reader.name} feeds ${target.name} without checking the analysis is ready`,
				).toContain(target.type);
			}
		}
	});

	it('invents no contact: no placeholder address stands in for a missing one', () => {
		expect(raw).not.toMatch(/example\.invalid/);
	});

	it('calls a missed caller back at most once per four hours, never forever', () => {
		const starter = workflow.nodes.find(
			(n) => n.name === 'Call them back' && n.parameters.operation === 'startCall',
		);
		if (!starter) return;
		const expression = String(
			(starter.parameters.options as Record<string, string>).idempotencyKey,
		);
		const keyFor = (number: string, atMs: number) =>
			new Function(
				'$',
				'$now',
				`return (${expression.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`,
			)(() => ({ item: { json: { data: { fromNumber: number, callId: 'call-1' } } } }), {
				toMillis: () => atMs,
			}) as string;
		const noon = Date.UTC(2026, 10, 24, 12, 0, 0);
		const key = keyFor('+1 (415) 555-0123', noon);
		expect(key).toMatch(/^callback-\+14155550123-\d+$/);
		// The same caller ringing again within the window is the same operation...
		expect(keyFor('+14155550123', noon + 3 * 3_600_000)).toBe(key);
		// ...another caller, or the same one much later, is a new one.
		expect(keyFor('+14155550124', noon)).not.toBe(key);
		expect(keyFor('+14155550123', noon + 5 * 3_600_000)).not.toBe(key);
	});

	it('reads the phone number from one line, never into the next', () => {
		const prepare = workflow.nodes.find(
			(n) => n.type === 'n8n-nodes-base.set' && JSON.stringify(n.parameters).includes('Phone:'),
		);
		if (!prepare) return;
		const assignments = (
			prepare.parameters.assignments as { assignments: Array<{ name: string; value: string }> }
		).assignments;
		const expression = assignments.find((a) => a.name === 'phone')!.value;
		const read = new Function(
			'$json',
			`return (${expression.replace(/^=\{\{/, '').replace(/\}\}$/, '')});`,
		) as (json: unknown) => string;
		expect(read({ description: 'Phone: +14155550123\n12 Main Street\nName: Ada' })).toMatch(
			/^\+?14155550123$/,
		);
		expect(read({ description: 'Name: Ada\nPhone: +1 (415) 555-0123' }).replace(/\D/g, '')).toBe(
			'14155550123',
		);
		expect(read({ description: 'No number here' })).toBe('');
	});
});

describe('the HTTP Request alternative', () => {
	it('needs no community node', () => {
		const alternative = workflows.find((w) => w.entry.file.startsWith('alternatives/'))!;
		expect(alternative.workflow.nodes.some((n) => n.type.startsWith('n8n-nodes-ringee'))).toBe(
			false,
		);
		expect(existsSync(join(workflowDir, alternative.entry.file))).toBe(true);
	});
});
