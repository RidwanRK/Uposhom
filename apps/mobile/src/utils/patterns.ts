import { toBn, toLatinDigits } from './bangla';

/**
 * Input validation for the dosage pattern field on the confirm screen. This only checks the
 * *shape* so a person cannot confirm gibberish. The schedule engine on the server does the real
 * parsing; the app never computes doses.
 */
const SLOT = /^(\d{1,2}|\d{0,2}½|\d{1,2}\.5)$/;

export interface PatternResult {
  valid: boolean;
  /** Latin digits joined by '+', or 'SOS'. Empty when invalid. */
  canonical: string;
  slots: number;
}

export function normalizePattern(input: string): PatternResult {
  const invalid: PatternResult = { valid: false, canonical: '', slots: 0 };
  const cleaned = toLatinDigits(input).replace(/\s+/g, '').replace(/[-–]/g, '+').toUpperCase();
  if (cleaned === '') return invalid;
  if (cleaned === 'SOS' || cleaned === 'PRN') return { valid: true, canonical: 'SOS', slots: 0 };
  const parts = cleaned.split('+');
  if (parts.length < 3 || parts.length > 4) return invalid;
  if (!parts.every((p) => SLOT.test(p))) return invalid;
  if (parts.every((p) => p === '0')) return invalid; // a pattern with no dose at all
  return { valid: true, canonical: parts.join('+'), slots: parts.length };
}

/** '1+0+1' to '১+০+১' for display. */
export function displayPattern(canonical: string): string {
  return canonical === 'SOS' ? 'প্রয়োজনে (SOS)' : toBn(canonical);
}

/** Quick-pick chips (design.md 6.3). */
export const PATTERN_CHIPS = [
  '1+0+1',
  '0+0+1',
  '1+1+1',
  '1+0+0',
  '0+1+0',
  '1+1+1+1',
  'SOS',
] as const;

export const DURATION_STEPS = [3, 5, 7, 10, 14, 21, 30] as const;

/** '৭ দিন', '১৪ দিন', '১ মাস' */
export function durationLabelBn(days: number): string {
  if (days > 0 && days % 30 === 0) return `${toBn(days / 30)} মাস`;
  return `${toBn(days)} দিন`;
}
