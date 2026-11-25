/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-dangerous-functions -- tests read the repository's template files and evaluate the template's own expressions; tests are never published */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TemplateNode {
	id: string;
	name: string;
	type: string;
	typeVersion: number;
	position: [number, number];
	parameters: Record<string, unknown>;
	onError?: string;
}

export interface Template {
	file: string;
	nodes: TemplateNode[];
	connections: Record<
		string,
		Record<string, Array<Array<{ node: string; type: string; index: number }> | undefined>>
	>;
	node(name: string): TemplateNode;
	/** True when a node of this name exists. */
	has(name: string): boolean;
}

const workflowDir = join(__dirname, '..', '..', 'workflows');

/** Every workflow template that is a real workflow (the catalog and the alternatives folder are not). */
export function loadTemplates(): Template[] {
	return readdirSync(workflowDir)
		.filter((file) => file.endsWith('.json') && file !== 'catalog.json')
		.sort()
		.map((file) => {
			const workflow = JSON.parse(readFileSync(join(workflowDir, file), 'utf8')) as Pick<
				Template,
				'nodes' | 'connections'
			>;
			const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
			return {
				file,
				...workflow,
				has: (name: string) => byName.has(name),
				node: (name: string) => {
					const found = byName.get(name);
					if (!found) throw new Error(`${file} has no node "${name}"`);
					return found;
				},
			};
		});
}

/** A template that places calls with the Ringee node. */
export const startsCalls = (template: Template): boolean =>
	template.nodes.some(
		(node) => node.type === 'n8n-nodes-ringee.ringee' && node.parameters.operation === 'startCall',
	);

/**
 * Evaluates an n8n expression (`={{ … }}`) the way the templates use them:
 * plain JavaScript over the names n8n puts in scope (`$json`, `$input`, `Date`…).
 */
export function evaluate(expression: unknown, scope: Record<string, unknown> = {}): unknown {
	const source = String(expression)
		.replace(/^=\{\{/, '')
		.replace(/\}\}$/, '');
	return new Function(...Object.keys(scope), `return (${source});`)(...Object.values(scope));
}

/** A `Set` node's assignments, evaluated against one incoming item. */
export function assignmentsOf(
	node: TemplateNode,
	scope: Record<string, unknown>,
): Record<string, unknown> {
	const { assignments } = node.parameters.assignments as {
		assignments: Array<{ name: string; value: string }>;
	};
	return Object.fromEntries(assignments.map((a) => [a.name, evaluate(a.value, scope)]));
}
