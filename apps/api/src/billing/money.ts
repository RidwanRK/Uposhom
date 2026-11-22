/**
 * Money is a decimal BDT string on the wire ("5.00") and integer poisha (1/100 taka) in the code.
 * Never a float: 0.1 + 0.2 is not 0.3, and "paid covers amount" must be exact.
 */

/** "5", "5.0", "5.00" -> 500. Returns null for anything that is not a plain non-negative decimal. */
export function toPoisha(amount: string | null | undefined): number | null {
  if (typeof amount !== 'string') return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return null;
  const taka = Number(match[1]);
  const poisha = Number((match[2] ?? '').padEnd(2, '0'));
  const total = taka * 100 + poisha;
  return Number.isSafeInteger(total) ? total : null;
}

export function fromPoisha(poisha: number): string {
  const whole = Math.trunc(poisha / 100);
  const frac = String(poisha % 100).padStart(2, '0');
  return `${whole}.${frac}`;
}

/** True when `paid` is a valid amount at least equal to `due`. Unparseable values never cover. */
export function covers(paid: string | null | undefined, due: string): boolean {
  const p = toPoisha(paid);
  const d = toPoisha(due);
  return p !== null && d !== null && p >= d;
}
