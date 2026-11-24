#!/usr/bin/env node
/**
 * Validates workflow templates against the node definitions of a real n8n.
 *
 * CI cannot do this: n8n's own node definitions are not part of this repository
 * (and are not MIT-licensed), so the unit tests check structure and the Ringee
 * nodes only. Run this before publishing a template, or after changing one:
 *
 *   1. Start n8n with the package installed (docs/local-development.md).
 *   2. Save its node catalog:
 *        curl -s --compressed -b cookies.txt http://localhost:5678/types/nodes.json -o nodes.json
 *   3. node scripts/validate-workflows.mjs nodes.json workflows/*.json workflows/alternatives/*.json   (non-workflow files are skipped)
 *
 * It reports, per node: an unknown node type or version, a parameter that does
 * not exist or is not shown for the chosen options, and a required parameter
 * that is not set. Empty selections (an agent, a sheet, a calendar) are the
 * user's to make and are filled in for the check.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';

// n8n-workflow's ES build has extensionless imports Node cannot resolve; its CommonJS build works.
const { NodeHelpers } = createRequire(import.meta.url)('n8n-workflow');

const [typesFile, ...files] = process.argv.slice(2);
if (!typesFile || files.length === 0) {
	console.error('Usage: node scripts/validate-workflows.mjs <nodes.json> <workflow.json>...');
	process.exit(2);
}

const types = JSON.parse(readFileSync(typesFile, 'utf8'));
const byName = new Map();
for (const type of types) {
	if (!byName.has(type.name)) byName.set(type.name, []);
	byName.get(type.name).push(type);
}

const describe = (type, version) =>
	(byName.get(type) ?? []).find((entry) =>
		Array.isArray(entry.version) ? entry.version.includes(version) : entry.version === version,
	);

const fillSelections = (value) => {
	if (Array.isArray(value)) return value.map(fillSelections);
	if (value && typeof value === 'object') {
		if (value.__rl && value.value === '') return { ...value, value: 'PLACEHOLDER' };
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillSelections(v)]));
	}
	return value;
};

function unseen(given, kept, properties, trail, problems) {
	if (!given || typeof given !== 'object' || Array.isArray(given)) return;
	for (const key of Object.keys(given)) {
		if (!kept || !(key in kept)) {
			problems.push(`${trail}${key}: is not a parameter shown here`);
			continue;
		}
		const property = (properties ?? []).find((p) => p.name === key);
		if (property?.type === 'collection' && Array.isArray(property.options)) {
			unseen(given[key], kept[key], property.options, `${trail}${key}.`, problems);
		}
		if (property?.type === 'fixedCollection' && Array.isArray(property.options)) {
			for (const group of Object.keys(given[key] ?? {})) {
				const definition = property.options.find((o) => o.name === group);
				if (!definition) {
					problems.push(`${trail}${key}.${group}: unknown group`);
					continue;
				}
				const rows = [].concat(given[key][group]);
				const keptRows = [].concat(kept[key]?.[group]);
				rows.forEach((row, i) =>
					unseen(row, keptRows[i], definition.values, `${trail}${key}.${group}[${i}].`, problems),
				);
			}
		}
	}
}

let failures = 0;
for (const file of files) {
	const workflow = JSON.parse(readFileSync(file, 'utf8'));
	if (!Array.isArray(workflow.nodes)) continue; // catalog.json and other non-workflow files
	const problems = [];
	for (const original of workflow.nodes) {
		const description = describe(original.type, original.typeVersion);
		if (!description) {
			problems.push(`${original.name}: unknown node ${original.type} v${original.typeVersion}`);
			continue;
		}
		const node = { ...original, parameters: fillSelections(original.parameters ?? {}) };
		const kept = NodeHelpers.getNodeParameters(
			description.properties,
			node.parameters,
			true,
			false,
			node,
			description,
		);
		unseen(node.parameters, kept, description.properties, `${node.name} › `, problems);
		for (const property of description.properties) {
			if (!property.required || !(property.name in kept)) continue;
			const value = kept[property.name];
			const empty = value === '' || value === undefined || value === null;
			if (empty && node.parameters[property.name] === undefined) {
				problems.push(`${node.name} › ${property.name}: required but not set`);
			}
		}
	}
	console.log(`${problems.length ? '✖' : '✓'} ${basename(file)} (${workflow.nodes.length} nodes)`);
	for (const problem of problems) console.log(`   - ${problem}`);
	failures += problems.length;
}
process.exit(failures ? 1 : 0);
