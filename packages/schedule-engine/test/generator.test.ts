import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANCHORS,
  ScheduleInputError,
  generateSchedule,
  type PrescribedItem,
  type ScheduleInput,
} from '../src/index.js';
import { PRESCRIPTIONS } from './fixtures.js';

const START = '2026-11-21';
const MIDNIGHT = '2026-11-21T00:00:00+06:00';

const run = (items: PrescribedItem[], extra: Partial<ScheduleInput> = {}) =>
  generateSchedule({ items, anchors: DEFAULT_ANCHORS, startDate: START, now: MIDNIGHT, ...extra });

describe('the 30 synthetic prescriptions', () => {
  it('has 30 cases', () => {
    expect(PRESCRIPTIONS).toHaveLength(30);
  });

  it.each(PRESCRIPTIONS.map((c) => [c.id, c.title, c] as const))('%s %s', (_id, _title, rx) => {
    const result = run(rx.items.map(({ expect: _e, ...item }) => item));
    rx.items.forEach((item, i) => {
      const got = result.items[i]!;
      expect(got.key).toBe(item.key);
      expect(got.status).toBe(item.expect.status);
      if (got.status === 'SCHEDULED') {
        expect(got.slots).toEqual(item.expect.slots);
        expect(got.dosesPerDay).toBe(item.expect.dosesPerDay);
        const mine = result.events.filter((e) => e.itemKey === item.key);
        expect(mine).toHaveLength(got.eventCount);
        if (got.slots[0] !== 'STAT')
          expect(got.eventCount).toBe(got.dosesPerDay * item.durationDays!);
        for (const e of mine) expect(e.isCritical).toBe(item.isCritical === true);
      }
      if (got.status === 'NEEDS_MANUAL_INPUT') expect(got.reasons).toEqual(item.expect.reasons);
    });
    expect(result.needsManualInput).toBe(
      rx.items.some((i) => i.expect.status === 'NEEDS_MANUAL_INPUT'),
    );
  });
});

describe('times', () => {
  it('1+0+1 BDPC with 08:00 and 21:00 meals gives 08:30 and 21:30 Dhaka', () => {
    const { events } = run([{ key: 'x', pattern: '1+0+1 BDPC', durationDays: 1 }]);
    expect(events.map((e) => e.dueAt)).toEqual([
      '2026-11-21T08:30:00+06:00',
      '2026-11-21T21:30:00+06:00',
    ]);
    expect(events[0]!.dueAtMs).toBe(Date.parse('2026-11-21T02:30:00Z'));
    expect(events[0]!.mealRelation).toBe('PC');
  });

  it('AC is before the meal and WITH_MEAL is at it', () => {
    const ac = run([{ key: 'x', pattern: '1+0+0', mealRelation: 'AC', durationDays: 1 }]).events;
    const wm = run([
      { key: 'x', pattern: '1+0+0', mealRelation: 'WITH_MEAL', durationDays: 1 },
    ]).events;
    expect(ac[0]!.dueAt).toBe('2026-11-21T07:30:00+06:00');
    expect(wm[0]!.dueAt).toBe('2026-11-21T08:00:00+06:00');
  });

  it('uses the evening anchor only for four-slot patterns', () => {
    const { events } = run([{ key: 'x', pattern: '1+1+1+1', durationDays: 1 }]);
    expect(events.map((e) => e.dueAt.slice(11, 16))).toEqual(['08:00', '13:30', '18:00', '21:00']);
  });

  it('HS is an hour after the night meal and ignores the meal offset', () => {
    const { events } = run([{ key: 'x', pattern: 'HS', mealRelation: 'PC', durationDays: 1 }]);
    expect(events[0]!.dueAt).toBe('2026-11-21T22:00:00+06:00');
    expect(events[0]!.slot).toBe('BEDTIME');
  });

  it('follows the profile meal times and config offsets', () => {
    const { events } = run([{ key: 'x', pattern: '1+0+0 AC', durationDays: 1 }], {
      anchors: { morning: '07:15', noon: '12:00', evening: '17:00', night: '22:00' },
      config: { offsets: { AC: -15 } },
    });
    expect(events[0]!.dueAt).toBe('2026-11-21T07:00:00+06:00');
  });

  it('a late night meal plus PC rolls into the next calendar day but keeps its course date', () => {
    const { events } = run([{ key: 'x', pattern: '0+0+1', mealRelation: 'PC', durationDays: 1 }], {
      anchors: { morning: '08:00', noon: '13:00', evening: '18:00', night: '23:45' },
    });
    expect(events[0]!.dueAt).toBe('2026-11-22T00:15:00+06:00');
    expect(events[0]!.courseDate).toBe('2026-11-21');
  });

  it('crosses month and year ends', () => {
    const { events, items } = run([{ key: 'x', pattern: 'OD', durationDays: 3 }], {
      startDate: '2026-12-30',
    });
    expect(events.map((e) => e.courseDate)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(items[0]).toMatchObject({ courseEndsOn: '2027-01-01' });
  });
});

describe('confirmation time', () => {
  it('leaves out doses already past and counts them', () => {
    const { events, items } = run([{ key: 'x', pattern: '1+1+1', durationDays: 2 }], {
      now: '2026-11-21T14:00:00+06:00',
    });
    expect(events.map((e) => e.key)).toEqual([
      'x:2026-11-21:NIGHT',
      'x:2026-11-22:MORNING',
      'x:2026-11-22:NOON',
      'x:2026-11-22:NIGHT',
    ]);
    expect(items[0]).toMatchObject({
      skippedPastDoses: 2,
      eventCount: 4,
      courseEndsOn: '2026-11-22',
    });
  });

  it('keeps a dose due exactly now', () => {
    const { events } = run([{ key: 'x', pattern: '1+0+0', durationDays: 1 }], {
      now: '2026-11-21T08:00:00+06:00',
    });
    expect(events).toHaveLength(1);
  });

  it('accepts epoch milliseconds and UTC ISO', () => {
    const ms = Date.parse('2026-11-21T02:00:00Z'); // 08:00 Dhaka
    expect(run([{ key: 'x', pattern: 'OD', durationDays: 1 }], { now: ms }).events).toHaveLength(1);
    expect(
      run([{ key: 'x', pattern: 'OD', durationDays: 1 }], { now: '2026-11-21T02:00:01Z' }).events,
    ).toHaveLength(0);
  });

  it('puts a STAT dose at the confirmation time', () => {
    const { events, items } = run([{ key: 's', pattern: 'STAT', isCritical: true }], {
      now: '2026-11-21T15:42:10+06:00',
    });
    expect(events).toEqual([
      {
        key: 's:STAT',
        itemKey: 's',
        courseDate: '2026-11-21',
        slot: 'STAT',
        quantity: 1,
        mealRelation: 'NONE',
        dueAt: '2026-11-21T15:42:10+06:00',
        dueAtMs: Date.parse('2026-11-21T15:42:10+06:00'),
        isCritical: true,
      },
    ]);
    expect(items[0]).toMatchObject({
      status: 'SCHEDULED',
      courseEndsOn: null,
      refillDueOn: null,
      eventCount: 1,
    });
  });
});

describe('refill date', () => {
  it('is the first day the pills do not cover', () => {
    const { items } = run([{ key: 'x', pattern: '1+0+1', durationDays: 90, pillCount: 60 }]);
    expect(items[0]).toMatchObject({ unitsPerDay: 2, refillDueOn: '2026-12-21' });
  });

  it('counts half tablets', () => {
    const { items } = run([{ key: 'x', pattern: '½+0+½', durationDays: 30, pillCount: 10 }]);
    expect(items[0]).toMatchObject({ unitsPerDay: 1, refillDueOn: '2026-12-01' });
  });

  it('is null when the supply lasts the course or no count is given', () => {
    expect(
      run([{ key: 'x', pattern: 'BD', durationDays: 5, pillCount: 10 }]).items[0],
    ).toMatchObject({ refillDueOn: null });
    expect(run([{ key: 'x', pattern: 'BD', durationDays: 5 }]).items[0]).toMatchObject({
      refillDueOn: null,
    });
  });

  it('is the start date when there are too few pills for one day', () => {
    expect(
      run([{ key: 'x', pattern: 'TDS', durationDays: 5, pillCount: 2 }]).items[0],
    ).toMatchObject({
      refillDueOn: START,
    });
  });
});

describe('needs manual input', () => {
  const reasons = (item: PrescribedItem) => {
    const r = run([item]);
    expect(r.needsManualInput).toBe(true);
    expect(r.events).toEqual([]);
    const got = r.items[0]!;
    return got.status === 'NEEDS_MANUAL_INPUT' ? got.reasons : null;
  };

  it.each([
    [{ durationDays: 0 }, 'BAD_DURATION'],
    [{ durationDays: 2.5 }, 'BAD_DURATION'],
    [{ durationDays: 366 }, 'BAD_DURATION'],
    [{ durationDays: 5, pillCount: -1 }, 'BAD_PILL_COUNT'],
    [{ durationDays: 5, pillCount: Number.NaN }, 'BAD_PILL_COUNT'],
    [{ durationDays: 5, confidence: Number.NaN }, 'LOW_CONFIDENCE'],
  ])('%j -> %s', (extra, reason) => {
    expect(reasons({ key: 'x', pattern: '1+0+1', ...extra })).toEqual([reason]);
  });

  it('collects every reason at once', () => {
    expect(reasons({ key: 'x', pattern: '5+0+5 PC', mealRelation: 'AC', confidence: 0.1 })).toEqual(
      ['LOW_CONFIDENCE', 'MEAL_RELATION_CONFLICT', 'BAD_QUANTITY', 'MISSING_DURATION'],
    );
  });

  it('low confidence also blocks as-needed and STAT items', () => {
    expect(reasons({ key: 'x', pattern: 'SOS', confidence: 0.5 })).toEqual(['LOW_CONFIDENCE']);
    expect(reasons({ key: 'x', pattern: 'STAT', confidence: 0.5 })).toEqual(['LOW_CONFIDENCE']);
  });

  it('a STAT quantity over the limit', () => {
    expect(reasons({ key: 'x', pattern: '9 STAT' })).toEqual(['BAD_QUANTITY']);
  });

  it('a confidence at the threshold passes', () => {
    expect(
      run([{ key: 'x', pattern: 'OD', durationDays: 1, confidence: 0.8 }]).needsManualInput,
    ).toBe(false);
  });

  it('the rest of the prescription is still worked out, but flagged', () => {
    const r = run([
      { key: 'ok', pattern: 'OD', durationDays: 2 },
      { key: 'bad', pattern: '1+1+1 BD', durationDays: 2 },
    ]);
    expect(r.needsManualInput).toBe(true);
    expect(r.events.every((e) => e.itemKey === 'ok')).toBe(true);
  });
});

describe('input the API must reject', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ScheduleInputError);
      return (err as ScheduleInputError).code;
    }
    return 'no error';
  };
  const item: PrescribedItem = { key: 'x', pattern: 'OD', durationDays: 1 };

  it.each([
    [{ anchors: { ...DEFAULT_ANCHORS, noon: '1:30' } }, 'BAD_ANCHOR'],
    [{ anchors: { ...DEFAULT_ANCHORS, night: '24:00' } }, 'BAD_ANCHOR'],
    [{ anchors: { ...DEFAULT_ANCHORS, evening: '13:30' } }, 'ANCHORS_OUT_OF_ORDER'],
    [{ anchors: { ...DEFAULT_ANCHORS, morning: '14:00' } }, 'ANCHORS_OUT_OF_ORDER'],
    [{ startDate: '2026-02-30' }, 'BAD_START_DATE'],
    [{ startDate: '21-11-2026' }, 'BAD_START_DATE'],
    [{ now: '2026-11-21T08:00:00' }, 'BAD_NOW'],
    [{ now: 'not a timeZ' }, 'BAD_NOW'],
    [{ now: Number.NaN }, 'BAD_NOW'],
  ])('%j -> %s', (extra, expected) => {
    expect(code(() => run([item], extra as Partial<ScheduleInput>))).toBe(expected);
  });

  it('duplicate and empty item keys', () => {
    expect(code(() => run([item, item]))).toBe('DUPLICATE_ITEM_KEY');
    expect(code(() => run([{ ...item, key: '' }]))).toBe('EMPTY_ITEM_KEY');
  });

  it('an empty prescription is fine and schedules nothing', () => {
    expect(run([])).toEqual({ events: [], items: [], needsManualInput: false });
  });
});
