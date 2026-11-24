#!/usr/bin/env node
/**
 * Checks that what would be published to npm is complete, clean and installable.
 *
 *   node scripts/check-package.mjs            manifest + `npm pack --dry-run` contents
 *   node scripts/check-package.mjs --install  also installs the real tarball into an
 *                                             empty directory and loads every node,
 *                                             which proves the package works without
 *                                             the Ringee monorepo or this repository
 *
 * Run `npm run build` first: the package ships the compiled files in dist/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (condition, message) => {
	if (!condition) failures.push(message);
};
const run = (command, args, cwd = root) =>
	execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// ── The manifest ────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
check(
	/^(@[a-z0-9-]+\/)?n8n-nodes-[a-z0-9-]+$/.test(pkg.name),
	`name "${pkg.name}" must start with n8n-nodes-`,
);
check(
	/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version),
	`version "${pkg.version}" is not semantic`,
);
check(
	pkg.keywords?.includes('n8n-community-node-package'),
	'keywords must include n8n-community-node-package',
);
check(pkg.license === 'MIT', 'n8n verification requires the MIT license');
check(
	!pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
	'verified community nodes may not have runtime dependencies',
);
check(
	Object.keys(pkg.peerDependencies ?? {}).join() === 'n8n-workflow',
	'the only peer dependency must be n8n-workflow',
);
check(pkg.n8n?.n8nNodesApiVersion === 1, 'n8n.n8nNodesApiVersion must be 1');
check(pkg.n8n?.strict === true, 'n8n.strict must be true (default lint config, cloud eligible)');
check(
	/ringee-io\/n8n-nodes-ringee/.test(pkg.repository?.url ?? ''),
	'repository.url must point to ringee-io/n8n-nodes-ringee',
);
check(
	/@ringee\.io$/.test(pkg.author?.email ?? ''),
	'author.email must be a Ringee address, never a personal one',
);
check(pkg.homepage === 'https://ringee.io', 'homepage must be https://ringee.io');
check(JSON.stringify(pkg.files) === JSON.stringify(['dist']), 'files must be exactly ["dist"]');
check(existsSync(join(root, 'LICENSE')), 'LICENSE is missing');
check(existsSync(join(root, 'README.md')), 'README.md is missing');

// ── What would be published ─────────────────────────────────────────────────
const [packed] = JSON.parse(run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']));
const files = packed.files.map((f) => f.path);
const has = (path) => files.includes(path);

for (const path of [...(pkg.n8n?.nodes ?? []), ...(pkg.n8n?.credentials ?? [])]) {
	check(
		has(path),
		`${path} (named in package.json "n8n") is not in the package: run npm run build`,
	);
}
for (const path of [
	'dist/nodes/Ringee/ringee.svg',
	'dist/nodes/Ringee/ringee.dark.svg',
	'dist/credentials/ringee.svg',
	'dist/credentials/ringee.dark.svg',
	'dist/nodes/Ringee/Ringee.node.json',
	'dist/nodes/RingeeTrigger/RingeeTrigger.node.json',
	'dist/nodes/Ringee/Ringee.node.d.ts',
	'dist/lib/api/client.js',
	'package.json',
	'README.md',
	'LICENSE',
]) {
	check(has(path), `${path} is missing from the package`);
}
for (const path of files) {
	check(
		!/^(tests|scripts|workflows|docs|\.github|\.agents|\.vscode)\//.test(path),
		`${path} must not be published`,
	);
	check(
		!/(^|\/)\.env/.test(path) && !/\.(pem|key|tgz)$/.test(path),
		`${path} looks like a secret or a build artifact`,
	);
	check(!/(^|\/)node_modules\//.test(path), `${path} is a dependency`);
	check(
		!/^(nodes|credentials|lib)\/.*\.ts$/.test(path),
		`${path} is TypeScript source; only compiled output ships`,
	);
	check(!/^(tsconfig|vitest|eslint)/.test(path), `${path} is development configuration`);
}
check(packed.size < 400_000, `the tarball is ${packed.size} bytes; expected under 400 KB`);

// Published text must not carry secrets or a personal address.
const secrets = [
	/cik_live_[0-9a-f]{20,}/,
	/whsec_[0-9a-f]{20,}/,
	/sk-[A-Za-z0-9]{20,}/,
	/[\w.+-]+@(gmail|outlook|yahoo|hotmail|icloud)\.com/i,
];
for (const path of files.filter((p) => /\.(js|json|md|svg|ts|map)$/.test(p))) {
	const full = join(root, path);
	if (!existsSync(full)) continue;
	const text = readFileSync(full, 'utf8');
	for (const pattern of secrets) check(!pattern.test(text), `${path} matches ${pattern}`);
}

// ── Installs on its own ─────────────────────────────────────────────────────
if (process.argv.includes('--install')) {
	const work = mkdtempSync(join(tmpdir(), 'ringee-n8n-install-'));
	try {
		run('npm', ['pack', '--pack-destination', work, '--ignore-scripts', '--silent']);
		const tarball = join(work, `${pkg.name}-${pkg.version}.tgz`);
		const project = join(work, 'project');
		run('mkdir', ['-p', project]);
		writeFileSync(join(project, 'package.json'), '{"name":"install-check","private":true}\n');
		run(
			'npm',
			['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--silent'],
			project,
		);

		const probe = `
			const pkg = require('${pkg.name}/package.json');
			const load = (p) => require('${pkg.name}/' + p);
			const out = [];
			for (const file of pkg.n8n.nodes) {
				const mod = load(file);
				const Node = Object.values(mod)[0];
				const node = new Node();
				out.push('node:' + node.description.name + ':' + node.description.properties.length);
			}
			for (const file of pkg.n8n.credentials) {
				const mod = load(file);
				const Credential = Object.values(mod)[0];
				out.push('credential:' + new Credential().name);
			}
			console.log(out.join(','));`;
		const result = run(process.execPath, ['-e', probe], project).trim();
		check(
			/node:ringee:\d+,node:ringeeTrigger:\d+,credential:ringeeApi/.test(result),
			`the installed package did not load as expected: ${result}`,
		);
		check(
			!existsSync(join(project, 'node_modules', 'ringee')),
			'unexpected monorepo package in the install',
		);
		console.log(`installed and loaded from the tarball: ${result}`);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (failures.length) {
	console.error(
		`✖ ${failures.length} problem(s) with the package:\n${failures.map((f) => `  - ${f}`).join('\n')}`,
	);
	process.exit(1);
}
console.log(
	`✓ package is complete and clean: ${files.length} files, ${(packed.size / 1024).toFixed(0)} KB packed, ${(packed.unpackedSize / 1024).toFixed(0)} KB unpacked`,
);
