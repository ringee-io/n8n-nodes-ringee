#!/usr/bin/env node
/**
 * Generates the template documentation from workflows/catalog.json, so the
 * catalog stays the single source of truth:
 *   - workflows/README.md          the catalog table and how to import
 *   - docs/workflow-templates.md   one section per template
 *
 *   node scripts/build-template-docs.mjs          write the files
 *   node scripts/build-template-docs.mjs --check  fail if they are out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { templates } = JSON.parse(readFileSync(join(root, 'workflows/catalog.json'), 'utf8'));

const yes = (value) => (value ? 'yes' : 'no');
const list = (items) => items.map((item) => `- ${item}`).join('\n');
const numbered = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');
const rawUrl = (file) =>
	`https://raw.githubusercontent.com/ringee-io/n8n-nodes-ringee/main/workflows/${file}`;

function catalogReadme() {
	const rows = templates
		.map(
			(t) =>
				`| ${t.id.startsWith('alt-') ? 'Alt' : t.id.slice(0, 2)} | [${t.title}](${t.file}) | ${t.requiredIntegrations.join(', ')} | ${t.audience} | ${t.publicationStatus} |`,
		)
		.join('\n');
	return `<!-- Generated from catalog.json by scripts/build-template-docs.mjs. Do not edit by hand. -->

# Ringee workflow templates for n8n

Importable n8n workflows that put Ringee AI phone calls to work. Each one is a complete, working starting point with sticky notes that explain how it works, what to configure and what to watch for.

| #   | Template | Needs | For | Status |
| --- | -------- | ----- | --- | ------ |
${rows}

Full descriptions, prerequisites, configuration steps and expected results: [docs/workflow-templates.md](../docs/workflow-templates.md).

## Import a template

1. In n8n, open **Workflows → Import from file** (or paste the JSON into the canvas).
2. Open each Ringee node and choose your **Ringee API** credential.
3. Follow the **Setup** sticky note in the template.
4. Use a test number you control for the first run. Every number in these templates is fictional.

The templates need the Ringee community node. On n8n Cloud, where unverified community nodes cannot be installed, start with the [HTTP Request alternative](alternatives/01-ai-appointment-reminder-http-request.json).

## Read this before calling real people

These workflows place real phone calls and spend real credits. Call only people who agreed to be contacted, only at suitable hours, and follow your local rules on recording and automated calls. Ringee blocks numbers on your Do-Not-Call list and stops when credits run out, but permission to call is yours to confirm.

## Verification status

Every template is imported into a real n8n, its nodes are checked against n8n's own node definitions (\`npm run validate:templates\`), and the Ringee nodes in it are run against a mock of the Ringee API. None has been run end to end against live third-party accounts (Google, HubSpot, Slack, Facebook, GoHighLevel), so check each connected step before relying on it.
`;
}

function templatesDoc() {
	const sections = templates
		.map((t) => {
			const dependsOn = t.dependsOnUnavailable
				? `\n> **Depends on something Ringee does not provide:** ${t.dependsOnUnavailable}\n`
				: '';
			return `## ${t.id.startsWith('alt-') ? 'Alternative' : `Template ${t.id.slice(0, 2)}`}: ${t.title}

${t.description}
${dependsOn}
- **File:** [\`workflows/${t.file}\`](../workflows/${t.file}) ([raw](${rawUrl(t.file)}))
- **Business use case:** ${t.businessUseCase}
- **Who it is for:** ${t.audience}
- **Needs:** ${t.requiredIntegrations.join(', ')}
- **Ringee features:** ${t.ringeeFeatures.join('; ')}
- **Credentials:** ${t.credentials.join(', ')}
- **Publication:** ${t.publicationStatus}

**Prerequisites**

${list(t.prerequisites)}

**Configuration**

${numbered(t.configuration)}

**Sample data:** ${t.sampleData}

**Error handling:** ${t.errorHandling}

**Expected result:** ${t.expectedResults}

**Verification:** imported into n8n ${yes(t.status.importedInN8n)}; nodes validated against n8n definitions ${yes(t.status.nodesValidatedAgainstN8nDefinitions)}; Ringee nodes run against a mock API ${yes(t.status.ringeeNodesExecutedAgainstMockApi)}; tested with live third-party accounts ${yes(t.status.testedWithLiveThirdPartyAccounts)}.

[Ringee](${t.ringeeLink}) · [Documentation](https://docs.ringee.io)
`;
		})
		.join('\n---\n\n');
	return `<!-- Generated from workflows/catalog.json by scripts/build-template-docs.mjs. Do not edit by hand. -->

# Workflow templates

Ready-made n8n workflows for Ringee. Import them from [\`workflows/\`](../workflows/). Read [Reading results: events and polling](events-and-results.md) first: it explains why most templates wait for the AI analysis before reading a call's result.

Every phone number in these templates is fictional. These workflows place real calls: use your own test number first, and only call people who agreed to be called.

---

${sections}`;
}

const outputs = [
	[join(root, 'workflows/README.md'), catalogReadme()],
	[join(root, 'docs/workflow-templates.md'), templatesDoc()],
];

let stale = false;
for (const [path, content] of outputs) {
	let current = '';
	try {
		current = readFileSync(path, 'utf8');
	} catch {
		// not written yet
	}
	if (process.argv.includes('--check')) {
		if (current !== content) {
			console.error(`${path} is out of date: run npm run docs:templates`);
			stale = true;
		}
	} else {
		writeFileSync(path, content);
		console.log(`wrote ${path}`);
	}
}
process.exit(stale ? 1 : 0);
