/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals -- tests read the package files; tests are never published */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { INodeProperties } from 'n8n-workflow';
import { Ringee } from '../nodes/Ringee/Ringee.node';
import { RingeeTrigger } from '../nodes/RingeeTrigger/RingeeTrigger.node';
import { RingeeApi } from '../credentials/RingeeApi.credentials';
import { RESOURCES } from '../nodes/Ringee/resources';
import { RINGEE_EVENTS } from '../lib/types';

const root = join(__dirname, '..');
const node = new Ringee();
const trigger = new RingeeTrigger();
const credential = new RingeeApi();
const properties = node.description.properties;

const operationSelectors = (resource: string) =>
	properties.filter(
		(p) =>
			p.name === 'operation' &&
			(p.displayOptions?.show?.resource as string[] | undefined)?.includes(resource),
	);

/** Properties visible for one resource/operation, in tool mode or not. */
function visible(resource: string, operation: string, tool: boolean): INodeProperties[] {
	return properties.filter((p) => {
		const show = (p.displayOptions?.show ?? {}) as Record<string, unknown[]>;
		if (show.resource && !show.resource.includes(resource)) return false;
		if (show.operation && !show.operation.includes(operation)) return false;
		if (show['@tool'] && !show['@tool'].includes(tool)) return false;
		return true;
	});
}

describe('Ringee node description', () => {
	it('is a first-class node: credentials, icons, tool support', () => {
		const d = node.description;
		expect(d.name).toBe('ringee');
		expect(d.displayName).toBe('Ringee');
		expect(d.credentials).toEqual([{ name: 'ringeeApi', required: true }]);
		expect(d.usableAsTool).toBe(true);
		expect(d.inputs).toEqual(['main']);
		expect(d.outputs).toEqual(['main']);
		for (const file of ['ringee.svg', 'ringee.dark.svg']) {
			expect(existsSync(join(root, 'nodes/Ringee', file))).toBe(true);
		}
	});

	it('offers the six resources, each with a module', () => {
		const resource = properties.find((p) => p.name === 'resource')!;
		const values = (resource.options as Array<{ value: string }>).map((o) => o.value);
		expect(values).toEqual([
			'aiAgent',
			'call',
			'contact',
			'phoneNumber',
			'recording',
			'transcript',
		]);
		expect(Object.keys(RESOURCES).sort()).toEqual([...values].sort());
	});

	it('has a handler for every operation it lists, and lists every handler', () => {
		for (const [resource, module] of Object.entries(RESOURCES)) {
			const listed = new Set(
				operationSelectors(resource).flatMap((s) =>
					(s.options as Array<{ value: string }>).map((o) => o.value),
				),
			);
			expect([...listed].sort(), resource).toEqual(Object.keys(module.operations).sort());
		}
	});

	it('describes each operation the way the n8n UX guidelines ask', () => {
		const small = new Set(['or', 'a', 'an', 'the', 'of', 'to', 'in', 'and']);
		for (const resource of Object.keys(RESOURCES)) {
			for (const selector of operationSelectors(resource)) {
				for (const option of selector.options as Array<{
					name: string;
					description: string;
					action: string;
				}>) {
					const where = `${resource}.${option.name}`;
					// Name: Title Case.
					for (const word of option.name.split(' ')) {
						expect(small.has(word) || /^[A-Z0-9]/.test(word), `${where} name`).toBe(true);
					}
					// Action: sentence case, no trailing period.
					expect(option.action, where).toMatch(/^[A-Z]/);
					expect(option.action.endsWith('.'), where).toBe(false);
					// Description: a single sentence has no final period (n8n style); a
					// description of several sentences ends with one.
					const sentences = /\.\s/.test(option.description);
					expect(option.description.endsWith('.'), `${where} description`).toBe(sentences);
				}
			}
		}
	});

	it('keeps operations in alphabetical order, as n8n expects', () => {
		for (const resource of Object.keys(RESOURCES)) {
			for (const selector of operationSelectors(resource)) {
				const names = (selector.options as Array<{ name: string }>).map((o) => o.name);
				expect(names, resource).toEqual([...names].sort((a, b) => a.localeCompare(b)));
			}
		}
	});

	it('never shows two parameters with the same name for one operation', () => {
		for (const [resource, module] of Object.entries(RESOURCES)) {
			for (const operation of Object.keys(module.operations)) {
				for (const tool of [false, true]) {
					const names = visible(resource, operation, tool)
						.filter(
							(p) =>
								p.name !== 'operation' ||
								(p.displayOptions?.show as Record<string, unknown>)?.['@tool'] === undefined,
						)
						.map((p) => p.name);
					const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
					expect(duplicates, `${resource}.${operation} tool=${tool}`).toEqual([]);
				}
			}
		}
	});

	it('only refers to resources and operations that exist', () => {
		for (const property of properties) {
			const show = (property.displayOptions?.show ?? {}) as Record<string, string[]>;
			for (const resource of show.resource ?? [])
				expect(RESOURCES[resource], property.name).toBeDefined();
			for (const operation of show.operation ?? []) {
				const known = (show.resource ?? Object.keys(RESOURCES)).some(
					(r) => operation in RESOURCES[r].operations,
				);
				expect(known, `${property.name} → ${operation}`).toBe(true);
			}
		}
	});

	it('offers a destructive operation to people, never to an AI agent by default', () => {
		const forPeople = visible('contact', 'delete', false).find((p) => p.name === 'operation')!;
		const forTools = properties.filter(
			(p) =>
				p.name === 'operation' &&
				(p.displayOptions?.show as Record<string, unknown>)?.['@tool'] instanceof Array &&
				(p.displayOptions!.show!['@tool'] as boolean[]).includes(true),
		);
		const peopleOps = (forPeople.options as Array<{ value: string }>).map((o) => o.value);
		expect(peopleOps).toContain('delete');
		expect(forTools).toHaveLength(1);
		const toolOps = (forTools[0].options as Array<{ value: string }>).map((o) => o.value);
		expect(toolOps).not.toContain('delete');
		expect(toolOps.sort()).toEqual(peopleOps.filter((o) => o !== 'delete').sort());
	});

	it('requires what Ringee requires, and marks required fields as such', () => {
		const phone = visible('aiAgent', 'startCall', false).find((p) => p.name === 'phoneNumber')!;
		expect(phone.required).toBe(true);
		const agent = visible('aiAgent', 'startCall', false).find((p) => p.name === 'agentId')!;
		expect(agent.required).toBe(true);
		expect(agent.type).toBe('resourceLocator');
		expect((agent.modes ?? []).map((m) => m.name)).toEqual(['list', 'id']);
		expect(agent.modes![0].typeOptions?.searchListMethod).toBe('getAgents');
		expect(
			visible('contact', 'delete', false).find((p) => p.name === 'confirmPhoneNumber')?.required,
		).toBe(true);
	});

	it('gives every list a Return All and a Limit', () => {
		for (const [resource, operation] of [
			['aiAgent', 'getMany'],
			['aiAgent', 'getManyCalls'],
			['contact', 'getMany'],
			['call', 'getMany'],
		]) {
			const names = visible(resource, operation, false).map((p) => p.name);
			expect(names, `${resource}.${operation}`).toEqual(
				expect.arrayContaining(['returnAll', 'limit']),
			);
		}
	});

	it('loads the dropdowns it declares', () => {
		const declared = new Set<string>();
		const walk = (list: INodeProperties[]) =>
			list.forEach((p) => {
				p.modes?.forEach(
					(m) => m.typeOptions?.searchListMethod && declared.add(m.typeOptions.searchListMethod),
				);
				const mapper = p.typeOptions?.resourceMapper?.resourceMapperMethod;
				if (mapper) declared.add(`mapper:${mapper}`);
				(p.options as INodeProperties[] | undefined)?.forEach?.(
					(o) => 'name' in o && walk([o as INodeProperties]),
				);
			});
		walk(properties);
		walk(trigger.description.properties);
		const listSearch = Object.keys(node.methods.listSearch);
		const mapping = Object.keys(node.methods.resourceMapping);
		for (const name of declared) {
			if (name.startsWith('mapper:')) expect(mapping).toContain(name.slice(7));
			else expect(listSearch).toContain(name);
		}
		expect(declared.size).toBeGreaterThanOrEqual(4);
	});
});

describe('Ringee Trigger description', () => {
	const d = trigger.description;

	it('is a webhook trigger with no input', () => {
		expect(d.group).toEqual(['trigger']);
		expect(d.inputs).toEqual([]);
		expect(d.webhooks).toEqual([
			expect.objectContaining({
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: 'noData',
			}),
		]);
		expect(d.credentials).toEqual([{ name: 'ringeeApi', required: true }]);
	});

	it('offers exactly the events Ringee sends, no invented ones', () => {
		const events = d.properties.find((p) => p.name === 'events')!;
		const values = (events.options as Array<{ value: string }>).map((o) => o.value);
		expect(values).toEqual(RINGEE_EVENTS.map((e) => e.value));
		expect(values).toEqual([
			'call.completed',
			'call.outcome.updated',
			'call.failed',
			'call.missed',
			'recording.ready',
			'meeting.created',
			'callback.created',
			'note.created',
			'dnc.created',
		]);
		expect(events.default).toEqual(['call.completed']);
		expect(events.required).toBe(true);
	});

	it('tells the user how to finish the setup in Ringee', () => {
		const notice = d.properties.find((p) => p.type === 'notice')!;
		expect(notice.displayName).toMatch(/Production URL/);
		expect(notice.displayName).toMatch(/Signing Secret/);
	});
});

describe('Ringee API credential', () => {
	const field = (name: string) => credential.properties.find((p) => p.name === name)!;

	it('keeps secrets in password fields', () => {
		expect(field('apiKey').typeOptions?.password).toBe(true);
		expect(field('signingSecret').typeOptions?.password).toBe(true);
		expect(field('apiKey').required).toBe(true);
		expect(field('baseUrl').default).toBe('https://api.ringee.io');
	});

	it('authenticates with the key header Ringee documents, and no workspace id', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'X-Ringee-Api-Key': '={{$credentials.apiKey}}' } },
		});
		expect(credential.properties.map((p) => p.name)).toEqual([
			'apiKey',
			'baseUrl',
			'signingSecret',
		]);
	});

	it('tests the key with a read that works for any valid key', () => {
		expect(credential.test.request).toMatchObject({
			url: '/v1/capabilities',
			method: 'GET',
			disableFollowRedirect: true,
		});
		expect(credential.test.rules?.map((r) => r.properties.value)).toEqual([401, 404]);
	});

	it('does not open a generic "Custom API Call" door for AI tools to walk through', () => {
		expect((credential as { httpRequestNode?: unknown }).httpRequestNode).toBeUndefined();
	});

	it('has icons and documentation', () => {
		expect(credential.documentationUrl).toMatch(
			/^https:\/\/github\.com\/ringee-io\/n8n-nodes-ringee/,
		);
		for (const file of ['ringee.svg', 'ringee.dark.svg'])
			expect(existsSync(join(root, 'credentials', file))).toBe(true);
	});
});

describe('codex files', () => {
	const allowed = [
		'Data & Storage',
		'Finance & Accounting',
		'Marketing & Content',
		'Productivity',
		'Miscellaneous',
		'Sales',
		'Development',
		'Analytics',
		'Communication',
		'Utility',
	];
	it.each(['nodes/Ringee/Ringee.node.json', 'nodes/RingeeTrigger/RingeeTrigger.node.json'])(
		'%s uses community categories',
		(file) => {
			const codex = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
				categories: string[];
				node: string;
			};
			expect(codex.categories.length).toBeGreaterThan(0);
			for (const category of codex.categories) expect(allowed).toContain(category);
			expect(codex.node).toMatch(/^n8n-nodes-ringee\./);
		},
	);
});
