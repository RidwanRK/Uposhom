import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANCHORS,
  generateSchedule,
  type MealRelation,
  type PrescribedItem,
} from '../src/index.js';

/**
 * Property checks over many generated prescriptions (Master Plan section 6): the event count is
 * doses per day times days, times are ordered, keys never repeat. A seeded generator keeps every
 * run the same, so a failure always reproduces.
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS = [
  '1+0+1',
  '1+1+1',
  '0+0+1',
  '1+0+0',
  '1+1+1+1',
  '½+0+½',
  'OD',
  'BD',
  'TDS',
  'QID',
  'HS',
  '2+0+2',
  '১+০+১',
];
const MEALS: MealRelation[] = ['AC', 'PC', 'WITH_MEAL', 'NONE'];

describe('properties over 500 generated prescriptions', () => {
  const next = rng(20261121);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;

  for (let run = 0; run < 500; run++) {
    const count = 1 + Math.floor(next() * 5);
    const items: PrescribedItem[] = Array.from({ length: count }, (_, i) => ({
      key: `i${i}`,
      pattern: pick(PATTERNS),
      mealRelation: pick(MEALS),
      durationDays: 1 + Math.floor(next() * 60),
      isCritical: next() < 0.3,
    }));
    const startDate = `2026-${String(1 + Math.floor(next() * 12)).padStart(2, '0')}-${String(1 + Math.floor(next() * 28)).padStart(2, '0')}`;

    it(`run ${run}`, () => {
      const r = generateSchedule({
        items,
        anchors: DEFAULT_ANCHORS,
        startDate,
        now: `${startDate}T00:00:00+06:00`,
      });
      expect(r.needsManualInput).toBe(false);

      let expected = 0;
      for (const [i, s] of r.items.entries()) {
        if (s.status !== 'SCHEDULED') throw new Error(`item ${i} not scheduled`);
        expect(s.eventCount).toBe(s.dosesPerDay * items[i]!.durationDays!);
        expected += s.eventCount;
      }
      expect(r.events).toHaveLength(expected);

      for (let k = 1; k < r.events.length; k++) {
        expect(r.events[k]!.dueAtMs).toBeGreaterThanOrEqual(r.events[k - 1]!.dueAtMs);
      }
      expect(new Set(r.events.map((e) => e.key)).size).toBe(r.events.length);
      for (const e of r.events) {
        expect(Date.parse(e.dueAt)).toBe(e.dueAtMs);
        expect(e.dueAt.endsWith('+06:00')).toBe(true);
      }

      // Deterministic: the same input gives the same output.
      expect(
        generateSchedule({
          items,
          anchors: DEFAULT_ANCHORS,
          startDate,
          now: `${startDate}T00:00:00+06:00`,
        }),
      ).toEqual(r);
    });
  }
});
