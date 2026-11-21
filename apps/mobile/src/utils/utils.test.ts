import { describe, expect, it } from 'vitest';
import {
  bucketOfHour,
  formatClockBn,
  formatHHmmBn,
  formatMoneyBn,
  toBn,
  toLatinDigits,
} from './bangla';
import {
  dhakaDateKey,
  dhakaParts,
  durationBn,
  formatDateBn,
  formatTimeBn,
  relativeAgoBn,
} from './dates';
import { displayPattern, durationLabelBn, normalizePattern } from './patterns';
import { maskMsisdn, normalizeBdMsisdn } from './phone';

describe('bangla numerals and clock', () => {
  it('converts digits both ways', () => {
    expect(toBn('08:30')).toBe('০৮:৩০');
    expect(toBn(2026)).toBe('২০২৬');
    expect(toLatinDigits('০১৯৭৩')).toBe('01973');
  });

  it('formats times as part-of-day word plus Bangla digits (design.md section 4)', () => {
    expect(formatClockBn(8, 30)).toBe('সকাল ০৮:৩০');
    expect(formatClockBn(13, 30)).toBe('দুপুর ০১:৩০');
    expect(formatClockBn(17, 0)).toBe('বিকাল ০৫:০০');
    expect(formatClockBn(20, 30)).toBe('রাত ০৮:৩০');
    expect(formatClockBn(0, 30)).toBe('রাত ১২:৩০');
    expect(formatClockBn(12, 0)).toBe('দুপুর ১২:০০');
    expect(formatHHmmBn('08:00')).toBe('সকাল ০৮:০০');
  });

  it('never emits Latin AM or PM', () => {
    for (let h = 0; h < 24; h++) expect(formatClockBn(h, 5)).not.toMatch(/AM|PM/i);
  });

  it('buckets the day', () => {
    expect(bucketOfHour(4)).toBe('morning');
    expect(bucketOfHour(11)).toBe('morning');
    expect(bucketOfHour(12)).toBe('noon');
    expect(bucketOfHour(15)).toBe('noon');
    expect(bucketOfHour(16)).toBe('evening');
    expect(bucketOfHour(19)).toBe('evening');
    expect(bucketOfHour(20)).toBe('night');
    expect(bucketOfHour(3)).toBe('night');
  });

  it('formats money', () => {
    expect(formatMoneyBn(5)).toBe('৳৫.০০');
    expect(formatMoneyBn('30.00')).toBe('৳৩০.০০');
  });
});

describe('Asia/Dhaka dates', () => {
  it('reads wall-clock parts from the offset in the string', () => {
    const p = dhakaParts('2026-11-21T08:30:00+06:00');
    expect([p.year, p.month, p.day, p.hour, p.minute]).toEqual([2026, 11, 21, 8, 30]);
  });

  it('converts UTC instants to Dhaka without drift', () => {
    expect(dhakaDateKey('2026-11-20T20:00:00Z')).toBe('2026-11-21');
    expect(formatTimeBn('2026-11-21T14:30:00Z')).toBe('রাত ০৮:৩০');
  });

  it('formats the long Bangla date', () => {
    expect(formatDateBn('2026-11-21T08:00:00+06:00')).toBe('শনিবার, ২১ নভেম্বর ২০২৬');
  });

  it('formats relative and overdue durations', () => {
    const now = new Date('2026-11-21T10:00:00+06:00');
    expect(relativeAgoBn('2026-11-21T08:00:00+06:00', now)).toBe('২ ঘণ্টা আগে');
    expect(relativeAgoBn('2026-11-21T09:45:00+06:00', now)).toBe('১৫ মিনিট আগে');
    expect(durationBn(95)).toBe('১ ঘণ্টা ৩৫ মিনিট');
    expect(durationBn(30)).toBe('৩০ মিনিট');
  });
});

describe('dosage pattern input validation', () => {
  it('accepts Latin, Bangla, dash and fraction forms', () => {
    expect(normalizePattern('1+0+1')).toEqual({ valid: true, canonical: '1+0+1', slots: 3 });
    expect(normalizePattern('১+০+১')).toEqual({ valid: true, canonical: '1+0+1', slots: 3 });
    expect(normalizePattern('1-0-1')).toEqual({ valid: true, canonical: '1+0+1', slots: 3 });
    expect(normalizePattern('½+0+½').canonical).toBe('½+0+½');
    expect(normalizePattern('1+1+1+1').slots).toBe(4);
    expect(normalizePattern('sos')).toEqual({ valid: true, canonical: 'SOS', slots: 0 });
  });

  it('rejects ambiguous or empty patterns instead of guessing', () => {
    for (const bad of ['', '1+1', '1+0+1+0+1', 'abc', '0+0+0', '1++1', '1+x+1']) {
      expect(normalizePattern(bad).valid).toBe(false);
    }
  });

  it('shows Bangla digits', () => {
    expect(displayPattern('1+0+1')).toBe('১+০+১');
    expect(durationLabelBn(7)).toBe('৭ দিন');
    expect(durationLabelBn(30)).toBe('১ মাস');
  });
});

describe('Bangladeshi phone numbers', () => {
  it('normalises the common forms', () => {
    expect(normalizeBdMsisdn('01973579363')).toBe('01973579363');
    expect(normalizeBdMsisdn('+8801973579363')).toBe('01973579363');
    expect(normalizeBdMsisdn('8801973579363')).toBe('01973579363');
    expect(normalizeBdMsisdn('০১৯৭৩ ৫৭৯৩৬৩')).toBe('01973579363');
  });

  it('rejects numbers that are not Bangladeshi mobiles', () => {
    expect(normalizeBdMsisdn('0197357936')).toBeNull();
    expect(normalizeBdMsisdn('02123456789')).toBeNull();
    expect(normalizeBdMsisdn('')).toBeNull();
  });

  it('masks for display', () => {
    expect(maskMsisdn('01973579363')).toBe('019****9363');
  });
});
