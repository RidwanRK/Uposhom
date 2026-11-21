const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** 'Latin digits' to Bangla digits: 08:30 becomes ০৮:৩০. Non-digits pass through. */
export function toBn(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS.charAt(Number(d)));
}

/** Bangla digits to Latin digits, for input fields and the API. */
export function toLatinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export type Bucket = 'morning' | 'noon' | 'evening' | 'night';

/** Part of day for a 24 hour clock hour in Asia/Dhaka. Used for words and for timeline buckets. */
export function bucketOfHour(hour24: number): Bucket {
  if (hour24 >= 4 && hour24 < 12) return 'morning';
  if (hour24 >= 12 && hour24 < 16) return 'noon';
  if (hour24 >= 16 && hour24 < 20) return 'evening';
  return 'night';
}

export const BUCKET_WORD: Record<Bucket, string> = {
  morning: 'সকাল',
  noon: 'দুপুর',
  evening: 'বিকাল',
  night: 'রাত',
};

/**
 * One format everywhere: a part-of-day word followed by Bangla digits, never Latin AM/PM.
 * 08:30 is 'সকাল ০৮:৩০', 13:30 is 'দুপুর ০১:৩০', 17:00 is 'বিকাল ০৫:০০', 20:30 is 'রাত ০৮:৩০'.
 */
export function formatClockBn(hour24: number, minute: number): string {
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${BUCKET_WORD[bucketOfHour(hour24)]} ${toBn(pad2(h12))}:${toBn(pad2(minute))}`;
}

/** '08:30' (24h, as stored for meal times) to 'সকাল ০৮:৩০'. */
export function formatHHmmBn(hhmm: string): string {
  const [h = '0', m = '0'] = hhmm.split(':');
  return formatClockBn(Number(h), Number(m));
}

/** ৳৫.০০ */
export function formatMoneyBn(amount: number | string, decimals = 2): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  return `৳${toBn(n.toFixed(decimals))}`;
}

export function formatPercentBn(n: number): string {
  return `${toBn(Math.round(n))}%`;
}
