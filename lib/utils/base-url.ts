/** Ringee Cloud's API origin. Self-hosted installations use their own. */
export const DEFAULT_BASE_URL = 'https://api.ringee.io';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type BaseUrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * Turns the credential's Base URL into the API origin the node calls.
 *
 * The API key travels in a header, so the URL is the one thing that decides who
 * receives it. The rules are deliberately narrow:
 *
 * - `https` only, except for a loopback host, where plain `http` is how a
 *   local Ringee is reached during development;
 * - no embedded user name or password, query string or fragment;
 * - a trailing slash and a trailing `/api` are dropped, because the node adds
 *   `/api/v1/...` itself and people paste either form.
 *
 * Redirects are never followed (see the client), so a URL that answers with one
 * cannot move the key to another host.
 */
export function parseBaseUrl(raw: string | undefined | null): BaseUrlResult {
	const value = (raw ?? '').trim();
	if (!value) return { ok: true, url: DEFAULT_BASE_URL };

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return {
			ok: false,
			message: `The Base URL '${value}' is not a valid URL. Use the full address, for example ${DEFAULT_BASE_URL}.`,
		};
	}

	const isLoopback = LOOPBACK_HOSTS.has(url.hostname);
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
		return {
			ok: false,
			message:
				"The Base URL must start with 'https://'. Plain 'http://' is accepted only for localhost.",
		};
	}
	if (url.username || url.password) {
		return {
			ok: false,
			message:
				'The Base URL must not contain a user name or password. Put the API key in the API Key field.',
		};
	}
	if (url.search || url.hash) {
		return { ok: false, message: 'The Base URL must not contain a query string or a fragment.' };
	}

	let path = url.pathname.replace(/\/+$/, '');
	if (path.toLowerCase() === '/api') path = '';
	// A self-hosted Ringee behind a path prefix keeps it.
	return { ok: true, url: `${url.origin}${path}` };
}
