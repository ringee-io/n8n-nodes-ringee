/* eslint-disable no-console, @n8n/community-nodes/no-restricted-globals -- manual test runner that prints what it serves; never published */
import { MockRingee } from './mock-ringee.ts';

/**
 * Serves the mock Ringee API on a fixed port, for trying the node by hand in a
 * local n8n:  node tests/helpers/serve-mock.ts   (PORT=4010 by default).
 * Point the Ringee API credential's Base URL at http://127.0.0.1:4010.
 */
const mock = new MockRingee();
const port = Number(process.env.PORT ?? 4010);
mock.onRequest = (request) => {
	const key = request.headers['idempotency-key'];
	console.log(
		`${request.method} ${request.path}${request.query.page ? `?page=${request.query.page}` : ''}` +
			`${key ? ` [Idempotency-Key: ${String(key)}]` : ''}` +
			`${request.body ? ` ${JSON.stringify(request.body)}` : ''}`,
	);
};
// DROP_FIRST_START=1 loses the response to the first Start Call after placing it,
// to show that a retried node does not dial twice.
mock.dropNextStartResponse = process.env.DROP_FIRST_START === '1';
void mock
	.start(port)
	.then(() => console.log(`Mock Ringee API on ${mock.baseUrl} (API key: cik_live_ + 64 × "a")`));
