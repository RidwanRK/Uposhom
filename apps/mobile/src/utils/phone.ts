import { toLatinDigits } from './bangla';

/** Accepts 01XXXXXXXXX, 8801XXXXXXXXX, +8801XXXXXXXXX, with Bangla or Latin digits and spaces. */
export function normalizeBdMsisdn(input: string): string | null {
  let s = toLatinDigits(input).replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('880')) s = s.slice(2);
  if (!s.startsWith('0')) s = `0${s}`;
  return /^01[3-9]\d{8}$/.test(s) ? s : null;
}

/** 01973579363 to 019****9363, for display only. */
export function maskMsisdn(msisdn: string): string {
  const s = normalizeBdMsisdn(msisdn) ?? msisdn;
  return s.length >= 7 ? `${s.slice(0, 3)}****${s.slice(-4)}` : s;
}
