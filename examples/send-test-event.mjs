#!/usr/bin/env node
/**
 * Signs a sample Ringee event the way Ringee does and posts it to a webhook URL,
 * so you can try a Ringee Trigger workflow without placing a call.
 *
 *   node examples/send-test-event.mjs <url> <signing secret> <event.json> [options]
 *
 *   --new-id    give the event a fresh eventId (otherwise sending it twice shows
 *               the trigger skipping the repeat)
 *   --old       sign it ten minutes in the past (the trigger refuses it as stale)
 *   --tamper    change the body after signing (the trigger refuses it)
 *   --unsigned  send it with no signature (the trigger refuses it)
 *
 * The secret is the integration's whsec_… value, the same one in your Ringee API
 * credential. Nothing here talks to Ringee.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [url, secret, file, ...flags] = process.argv.slice(2);
if (!url || !secret || !file) {
	console.error(
		'Usage: node examples/send-test-event.mjs <url> <signing secret> <event.json> [--new-id] [--old] [--tamper] [--unsigned]',
	);
	process.exit(2);
}

const event = JSON.parse(readFileSync(file, 'utf8'));
if (flags.includes('--new-id')) event.eventId = `evt_${randomUUID().replace(/-/g, '')}`;

const body = JSON.stringify(event);
const signedAt = Math.floor(Date.now() / 1000) - (flags.includes('--old') ? 600 : 0);
const signature = createHmac('sha256', secret).update(`${signedAt}.${body}`).digest('hex');

const headers = { 'Content-Type': 'application/json' };
if (!flags.includes('--unsigned')) {
	headers['Ringee-Signature'] = `t=${signedAt},v1=${signature}`;
	headers['Ringee-Timestamp'] = String(signedAt);
}
const sent = flags.includes('--tamper') ? body.replace(/"callId":"/, '"callId":"x') : body;

const response = await fetch(url, { method: 'POST', headers, body: sent });
console.log(`${response.status} ${response.statusText}`);
console.log(await response.text());
