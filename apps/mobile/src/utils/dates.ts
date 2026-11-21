import { bucketOfHour, formatClockBn, pad2, toBn, type Bucket } from './bangla';

/** Bangladesh has no daylight saving: Asia/Dhaka is always UTC+6. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export const BN_WEEKDAYS = [
  'রবিবার',
  'সোমবার',
  'মঙ্গলবার',
  'বুধবার',
  'বৃহস্পতিবার',
  'শুক্রবার',
  'শনিবার',
];
export const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];

export interface DhakaParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

/** Wall-clock parts of an instant in Asia/Dhaka, independent of the phone's timezone. */
export function dhakaParts(input: Date | string | number): DhakaParts {
  const d = new Date(input);
  const s = new Date(d.getTime() + DHAKA_OFFSET_MS);
  return {
    year: s.getUTCFullYear(),
    month: s.getUTCMonth() + 1,
    day: s.getUTCDate(),
    hour: s.getUTCHours(),
    minute: s.getUTCMinutes(),
    weekday: s.getUTCDay(),
  };
}

/** 'yyyy-mm-dd' in Asia/Dhaka. */
export function dhakaDateKey(input: Date | string | number): string {
  const p = dhakaParts(input);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** 'শনিবার, ২১ নভেম্বর ২০২৬' */
export function formatDateBn(input: Date | string | number): string {
  const p = dhakaParts(input);
  return `${BN_WEEKDAYS[p.weekday]}, ${toBn(p.day)} ${BN_MONTHS[p.month - 1]} ${toBn(p.year)}`;
}

/** '২১ নভেম্বর ২০২৬' */
export function formatShortDateBn(input: Date | string | number): string {
  const p = dhakaParts(input);
  return `${toBn(p.day)} ${BN_MONTHS[p.month - 1]} ${toBn(p.year)}`;
}

/** 'সকাল ০৮:৩০' for an ISO instant. */
export function formatTimeBn(input: Date | string | number): string {
  const p = dhakaParts(input);
  return formatClockBn(p.hour, p.minute);
}

export function bucketOfInstant(input: Date | string | number): Bucket {
  return bucketOfHour(dhakaParts(input).hour);
}

/** '2026-11' to 'নভেম্বর ২০২৬' */
export function formatMonthKeyBn(key: string): string {
  const [y = '0', m = '1'] = key.split('-');
  return `${BN_MONTHS[Number(m) - 1] ?? ''} ${toBn(y)}`;
}

/** 'আপডেট: ২ ঘণ্টা আগে' style relative time. */
export function relativeAgoBn(
  input: Date | string | number,
  now: Date | number = Date.now(),
): string {
  const diffMin = Math.max(
    0,
    Math.round((new Date(now).getTime() - new Date(input).getTime()) / 60000),
  );
  if (diffMin < 1) return 'এইমাত্র';
  if (diffMin < 60) return `${toBn(diffMin)} মিনিট আগে`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${toBn(hours)} ঘণ্টা আগে`;
  return `${toBn(Math.floor(hours / 24))} দিন আগে`;
}

/** 'xx মিনিট' / 'x ঘণ্টা y মিনিট' for an overdue duration. */
export function durationBn(minutes: number): string {
  if (minutes < 60) return `${toBn(minutes)} মিনিট`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${toBn(h)} ঘণ্টা` : `${toBn(h)} ঘণ্টা ${toBn(m)} মিনিট`;
}
