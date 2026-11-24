const ALLOWED = /^\+?[0-9 ().-]+$/;

/**
 * A light check on a phone number before it is sent. Ringee does the real
 * validation — it knows which destinations are dialable and says so by name —
 * so this only catches the input that can never be a number: empty values,
 * letters, and text pasted from the wrong field.
 *
 * Formatting characters are removed, a leading `+` is kept, and the digits are
 * returned. E.164 (`+14155550123`) is the recommended form.
 */
export function cleanPhoneNumber(raw: unknown): { value?: string; problem?: string } {
	if (typeof raw !== 'string' || raw.trim() === '') {
		return { problem: 'Enter the phone number to call, for example +14155550123.' };
	}
	const trimmed = raw.trim();
	if (!ALLOWED.test(trimmed)) {
		return {
			problem: `'${trimmed.slice(0, 40)}' is not a phone number. Use digits with an optional leading '+', for example +14155550123.`,
		};
	}
	const digits = trimmed.replace(/[^\d]/g, '');
	if (digits.length < 6 || digits.length > 15) {
		return {
			problem: `'${trimmed}' has ${digits.length} digits. A phone number has between 6 and 15 digits, for example +14155550123.`,
		};
	}
	return { value: `${trimmed.startsWith('+') ? '+' : ''}${digits}` };
}
