import { defineConfig } from 'vitest/config';

/**
 * Optional checks against a real Ringee workspace. They never run in CI and
 * need RINGEE_TEST_API_KEY; see docs/integration-testing.md before using one.
 */
export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
		environment: 'node',
		testTimeout: 60_000,
	},
});
