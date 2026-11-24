import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { DEFAULT_BASE_URL } from '../lib/utils/base-url';

/**
 * The credential for Ringee's public API.
 *
 * One Ringee Custom Integration issues three things, and this credential holds
 * the ones n8n needs: the API key (every action), the API address (Ringee Cloud
 * or a self-hosted installation) and, for the Ringee Trigger, the secret that
 * signs the events Ringee sends. The key belongs to a workspace, so the
 * credential never carries a workspace or user id: Ringee derives both from the
 * key.
 */
export class RingeeApi implements ICredentialType {
	name = 'ringeeApi';

	displayName = 'Ringee API';

	documentationUrl = 'https://github.com/ringee-io/n8n-nodes-ringee#credentials';

	icon = { light: 'file:ringee.svg', dark: 'file:ringee.dark.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'cik_live_…',
			description:
				'The key of a Ringee Custom Integration. In Ringee, open Integrations, then Custom Integrations, create one and copy its API key. It starts with cik_live_ and is shown once.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: DEFAULT_BASE_URL,
			placeholder: DEFAULT_BASE_URL,
			description:
				'The address of the Ringee API, without /api. Leave it as is for Ringee Cloud. For a self-hosted Ringee, use your own API address.',
		},
		{
			displayName: 'Webhook Signing Secret',
			name: 'signingSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'whsec_…',
			description:
				'Only needed by the Ringee Trigger. The signing secret of the same Custom Integration, starting with whsec_. The trigger uses it to check that an event really comes from Ringee.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-Ringee-Api-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	/**
	 * Asks what the server can do: the lightest authenticated call, and one that
	 * works for any valid key whether or not the workspace has AI voice agents.
	 * Ringee answers 401 to a key it does not know or an integration that is
	 * disabled, and 404 when it is too old to have the route at all.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ ($credentials.baseUrl || "https://api.ringee.io").trim().replace(/\\/+$/, "").replace(/\\/api$/i, "") }}/api',
			url: '/v1/capabilities',
			method: 'GET',
			skipSslCertificateValidation: false,
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Ringee did not accept this API key. Check that it is current and that its Custom Integration is enabled.',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 404,
					message:
						'This Ringee server does not offer the public API this node needs. Check the Base URL, or update a self-hosted Ringee.',
				},
			},
		],
	};
}
