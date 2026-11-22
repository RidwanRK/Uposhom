/**
 * Asia/Dhaka wall-clock arithmetic without a time-zone database.
 *
 * Bangladesh has used a fixed UTC+06:00 with no daylight saving since 2009, so a constant offset is
 * exact for every date this app schedules. Keeping it constant keeps the engine pure and lets it
 * run the same on any server, whatever its own time zone.
 */
export const DHAKA_OFFSET_MINUTES = 6 * 60;
const OFFSET_MS = DHAKA_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 'HH:mm' to minutes after midnight, or null when malformed. */
export function parseClock(value: string): number | null {
  const m = TIME_RE.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 'YYYY-MM-DD' to the epoch milliseconds of that day's Dhaka midnight, or null when not a real date. */
export function dhakaMidnight(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return utc - OFFSET_MS;
}

/** The Dhaka calendar date `days` after the given Dhaka midnight. */
export function addDays(midnightMs: number, days: number): number {
  return midnightMs + days * DAY_MS;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Epoch milliseconds to the Dhaka date, 'YYYY-MM-DD'. */
export function toDhakaDate(ms: number): string {
  const d = new Date(ms + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Epoch milliseconds to ISO 8601 with the +06:00 offset, to the second. */
export function toDhakaIso(ms: number): string {
  const d = new Date(ms + OFFSET_MS);
  return (
    `${toDhakaDate(ms)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:` +
    `${pad(d.getUTCSeconds())}+06:00`
  );
}

/** An ISO string with an explicit offset (or 'Z'), or epoch milliseconds, to epoch milliseconds. */
export function parseInstant(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Only accept strings that state their offset, so the server's own zone never leaks in.
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
