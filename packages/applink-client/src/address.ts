/**
 * Subscriber-address helpers. `tel:` is added in exactly one place, here.
 */

/**
 * Normalise a subscriber address to `tel:<digits>`. Accepts an already-prefixed or masked value,
 * `+880...`, `00880...` or a local `01...` number. Addresses are sent without a `+`.
 */
export function toTelAddress(msisdn: string): string {
  const trimmed = (msisdn ?? '').trim();
  if (!trimmed) throw new Error('[applink] empty subscriber address');
  if (trimmed.toLowerCase().startsWith('tel:')) {
    return `tel:${trimmed.slice(4).replace(/[\s+]/g, '')}`;
  }
  let digits = trimmed.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `880${digits.slice(1)}`;
  return `tel:${digits}`;
}

/** Mask an address for logs: last three digits only. Never log the raw value. */
export function maskAddress(address: string): string {
  const body = address.replace(/^tel:/i, '');
  if (body.length <= 6) return 'tel:***';
  return `tel:${body.slice(0, 3)}${'*'.repeat(body.length - 6)}${body.slice(-3)}`;
}

/**
 * Normalise a Bangladeshi mobile number typed by a user to `8801XXXXXXXXX`, or null if it is not
 * one. Operator is deliberately not checked: any Bangladeshi number may sign up (Master Plan 17).
 */
export function normalizeBdMsisdn(input: string): string | null {
  let digits = (input ?? '').replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('880')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return /^1[3-9]\d{8}$/.test(digits) ? `880${digits}` : null;
}
