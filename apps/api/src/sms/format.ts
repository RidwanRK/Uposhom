/**
 * How many billed SMS parts a message takes. Bangla is UCS-2 (70 characters, 67 when split), plain
 * Latin text is GSM 7-bit (160, 153 when split). Each extra part is billed, so templates should
 * stay at one part where they can.
 */

// Basic GSM 7-bit characters we use; the extended set costs two characters each.
const GSM_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);

function isGsm(ch: string): boolean {
  if (GSM_EXTENDED.has(ch)) return true;
  const code = ch.codePointAt(0) ?? 0;
  return code === 0x0a || code === 0x0d || (code >= 0x20 && code <= 0x7e);
}

export function smsSegments(message: string): { encoding: 'GSM' | 'UCS2'; parts: number } {
  const chars = [...message];
  const gsm = chars.every(isGsm);
  if (!gsm) {
    const units = message.length; // UCS-2 counts UTF-16 code units
    return { encoding: 'UCS2', parts: units <= 70 ? 1 : Math.ceil(units / 67) };
  }
  const units = chars.reduce((n, ch) => n + (GSM_EXTENDED.has(ch) ? 2 : 1), 0);
  return { encoding: 'GSM', parts: units <= 160 ? 1 : Math.ceil(units / 153) };
}
