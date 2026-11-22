/**
 * Subscriber-address helpers. `tel:` is added in exactly one place, here.
 */

/**
 * Normalise a subscriber address to `tel:<digits>`. Accepts `+880...`, `00880...` or a local
 * `01...` number typed by a user.
 *
 * A value that already starts with `tel:` is passed through UNCHANGED (only trimmed): a
 * subscriber id is opaque, possibly masked, and must be stored and sent back exactly as Applink
 * gave it. Never parse, strip or reformat one.
 */
export function toTelAddress(msisdn: string): string {
  const trimmed = (msisdn ?? '').trim();
  if (!trimmed) throw new Error('[applink] empty subscriber address');
  if (trimmed.toLowerCase().startsWith('tel:')) return trimmed;
  let digits = trimmed.replace(/[\s()-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `880${digits.slice(1)}`;

  return `tel:${digits}`;
}

/**
 * The forms a callback might use for an id we stored in another form: Applink's samples show both
 * `tel:880...` and `tel:+880...`. Exact match first; the plus-less form only for a plain numeric
 * id. Used to FIND a stored subscriber, never to rewrite one.
 */
export function subscriberIdVariants(address: string): string[] {
  const a = address.trim();
  const m = /^tel:\+(\d+)$/i.exec(a);
  return m ? [a, `tel:${m[1]}`] : [a];
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
