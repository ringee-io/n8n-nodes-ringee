/* eslint-disable @n8n/community-nodes/no-restricted-globals -- opt-in checks read their settings from the environment; tests are never published */
import { describe, expect, it } from 'vitest';

/**
 * Opt-in checks against a real Ringee test workspace. See docs/integration-testing.md.
 * They never run in CI: they need RINGEE_TEST_API_KEY and are read-only unless
 * RINGEE_TEST_ALLOW_CALLS=1 is also set.
 */
const key = process.env.RINGEE_TEST_API_KEY;
const base = (process.env.RINGEE_TEST_BASE_URL ?? 'https://api.ringee.io')
	.replace(/\/+$/, '')
	.replace(/\/api$/, '');
const agentId = process.env.RINGEE_TEST_AGENT_ID;
const phone = process.env.RINGEE_TEST_PHONE;

const get = async (path: string) => {
	const response = await fetch(`${base}/api${path}`, {
		headers: { 'X-Ringee-Api-Key': key! },
		redirect: 'manual',
	});
	return { status: response.status, body: await response.json().catch(() => undefined) };
};

describe.skipIf(!key)('a real Ringee test workspace', () => {
	it('accepts the key and lists contacts', async () => {
		const { status, body } = await get('/v1/contacts?limit=1');
		expect(status).toBe(200);
		expect(body).toHaveProperty('data');
	});

	it('lists the caller numbers of AI voice agents (or says the workspace has none)', async () => {
		const { status } = await get('/v1/ai-voice-agents/phone-numbers');
		expect([200, 403]).toContain(status);
	});

	it.skipIf(!agentId)('reads the test agent with the variables its calls accept', async () => {
		const { status, body } = await get(`/v1/ai-voice-agents/${agentId}`);
		expect(status).toBe(200);
		expect(body).toHaveProperty('variables');
	});

	it.skipIf(!(agentId && phone && process.env.RINGEE_TEST_ALLOW_CALLS === '1'))(
		'places one call once, and the same key answers with that call',
		async () => {
			const idempotencyKey = `integration-test-${Date.now()}`;
			const start = () =>
				fetch(`${base}/api/v1/ai-voice-agents/${agentId}/calls`, {
					method: 'POST',
					headers: {
						'X-Ringee-Api-Key': key!,
						'Content-Type': 'application/json',
						'Idempotency-Key': idempotencyKey,
					},
					body: JSON.stringify({
						to: phone,
						variables: { first_name: 'Test', notification: 'an integration test' },
					}),
				}).then(async (r) => ({
					status: r.status,
					body: (await r.json()) as { id: string; idempotent_replayed: boolean },
				}));
			const first = await start();
			const second = await start();
			expect(first.status).toBe(201);
			expect(second.status).toBe(200);
			expect(second.body.id).toBe(first.body.id);
			expect(second.body.idempotent_replayed).toBe(true);
		},
	);
});
