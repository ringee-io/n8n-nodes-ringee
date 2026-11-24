import type { INodeProperties } from 'n8n-workflow';
import { aiAgent } from './aiAgent';
import { call } from './call';
import { contact } from './contact';
import { phoneNumber } from './phoneNumber';
import { recording } from './recording';
import { transcript } from './transcript';
import type { ResourceModule } from './types';

/** Every resource of the Ringee node, by the value of its Resource option. */
export const RESOURCES: Record<string, ResourceModule> = {
	aiAgent,
	call,
	contact,
	phoneNumber,
	recording,
	transcript,
};

export const RESOURCE_OPTIONS: NonNullable<INodeProperties['options']> = [
	{ name: 'AI Voice Agent', value: 'aiAgent' },
	{ name: 'Call', value: 'call' },
	{ name: 'Contact', value: 'contact' },
	{ name: 'Phone Number', value: 'phoneNumber' },
	{ name: 'Recording', value: 'recording' },
	{ name: 'Transcript', value: 'transcript' },
];
