import { describe, expect, it } from 'vitest';
import { nextStep, ladderBase, type LadderInput, type LadderStep } from '../src/domain/ladder.js';
import type { DoseStage } from '../src/domain/types.js';

const DUE = new Date('2026-11-22T15:30:00Z'); // 21:30 Dhaka
const t = (min: number) => new Date(DUE.getTime() + min * 60_000);

const input = (over: Partial<LadderInput> = {}): LadderInput => ({
  status: 'SCHEDULED',
  stage: 'PENDING',
  dueAt: DUE,
  snoozedUntil: null,
  isCritical: false,
  now: DUE,
  canEscalate: true,
  hasSecondary: true,
  primaryAlertedAt: null,
  secondaryAlertedAt: null,
  acknowledged: false,
  deliveryFailed: false,
  ...over,
});

const kind = (over: Partial<LadderInput>) => {
  const s = nextStep(input(over));
  return s.kind === 'REMIND' ? `REMIND${s.repeat ? '_REPEAT' : ''}` : s.kind;
};

/** Runs the ladder minute by minute as the tick job would, returning what happened when. */
function simulate(
  over: Partial<LadderInput>,
  until: number,
  events: Record<number, Partial<LadderInput>> = {},
) {
  let state: LadderInput = input(over);
  const log: string[] = [];
  for (let m = -5; m <= until; m++) {
    state = { ...state, now: t(m), ...events[m] };
    for (let guard = 0; guard < 5; guard++) {
      const step: LadderStep = nextStep(state);
      if (step.kind === 'WAIT') break;
      const label = step.kind === 'REMIND' ? (step.repeat ? 'REPEAT' : 'REMIND') : step.kind;
      log.push(`T+${m} ${label}`);
      state = { ...state, stage: step.to };
      if (step.kind === 'ALERT_PRIMARY') state.primaryAlertedAt = t(m);
      if (step.kind === 'ALERT_SECONDARY') state.secondaryAlertedAt = t(m);
      if (step.kind === 'MISS') state.status = 'MISSED';
    }
  }
  return log;
}

describe('the ladder, minute by minute', () => {
  it('non-critical: remind, repeat at 15, missed at 30, no caregiver alert', () => {
    expect(simulate({ isCritical: false }, 120)).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 MISS',
    ]);
  });

  it('critical: remind, repeat, caregiver at 30, secondary at 50, missed at 70', () => {
    expect(simulate({ isCritical: true }, 120)).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 ALERT_PRIMARY',
      'T+50 ALERT_SECONDARY',
      'T+70 MISS',
    ]);
  });

  it('critical, acknowledged by the caregiver: no secondary, still missed when the window ends', () => {
    expect(simulate({ isCritical: true }, 120, { 35: { acknowledged: true } })).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 ALERT_PRIMARY',
      'T+70 MISS',
    ]);
  });

  it('critical without a secondary caregiver: missed at 70', () => {
    expect(simulate({ isCritical: true, hasSecondary: false }, 120)).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 ALERT_PRIMARY',
      'T+70 MISS',
    ]);
  });

  it('critical on the Free tier or with no caregiver: the plain path', () => {
    expect(simulate({ isCritical: true, canEscalate: false }, 120)).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 MISS',
    ]);
  });

  it('a bounced reminder brings the caregiver alert forward, and the next rung keeps its gap', () => {
    expect(simulate({ isCritical: true }, 120, { 2: { deliveryFailed: true } })).toEqual([
      'T+0 REMIND',
      'T+2 ALERT_PRIMARY',
      'T+50 ALERT_SECONDARY',
      'T+70 MISS',
    ]);
  });

  it('a bounced reminder changes nothing for a non-critical dose', () => {
    expect(simulate({ isCritical: false }, 60, { 2: { deliveryFailed: true } })).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 MISS',
    ]);
  });

  it('taken at any point stops the ladder', () => {
    expect(simulate({ isCritical: true }, 120, { 40: { status: 'TAKEN_LATE' } })).toEqual([
      'T+0 REMIND',
      'T+15 REPEAT',
      'T+30 ALERT_PRIMARY',
      'T+40 CLOSE',
    ]);
  });
});

describe('catching up after downtime never sends stale messages', () => {
  it.each([
    [{ now: t(20) }, 'REMIND_REPEAT'],
    [{ now: t(40), isCritical: true }, 'ALERT_PRIMARY'],
    [{ now: t(40) }, 'MISS'],
    [{ now: t(69), isCritical: true }, 'ALERT_PRIMARY'],
    [{ now: t(70), isCritical: true }, 'MISS'],
  ])('%j -> %s', (over, expected) => {
    expect(kind(over)).toBe(expected);
  });

  it('a late caregiver alert still gets its 20 minutes before the secondary', () => {
    const late = {
      isCritical: true,
      stage: 'CAREGIVER_ALERTED' as DoseStage,
      primaryAlertedAt: t(45),
    };
    expect(kind({ ...late, now: t(55) })).toBe('WAIT');
    expect(kind({ ...late, now: t(65) })).toBe('ALERT_SECONDARY');
    expect(kind({ ...late, hasSecondary: false, now: t(80) })).toBe('WAIT');
    expect(kind({ ...late, hasSecondary: false, now: t(85) })).toBe('MISS');
  });

  it('a stage without its timestamp falls back to the standard times', () => {
    expect(kind({ isCritical: true, stage: 'CAREGIVER_ALERTED', now: t(50) })).toBe(
      'ALERT_SECONDARY',
    );
    expect(kind({ isCritical: true, stage: 'SECONDARY_ALERTED', now: t(69) })).toBe('WAIT');
    expect(kind({ isCritical: true, stage: 'SECONDARY_ALERTED', now: t(70) })).toBe('MISS');
  });
});

describe('snooze', () => {
  it('counts from the end of the snooze', () => {
    const snoozed = {
      status: 'SNOOZED' as const,
      snoozedUntil: t(15),
      stage: 'PENDING' as DoseStage,
    };
    expect(ladderBase(input(snoozed))).toEqual(t(15));
    expect(kind({ ...snoozed, now: t(10) })).toBe('WAIT');
    expect(kind({ ...snoozed, now: t(15) })).toBe('REMIND');
    expect(kind({ ...snoozed, now: t(44) })).toBe('REMIND_REPEAT');
    expect(kind({ ...snoozed, now: t(45) })).toBe('MISS');
  });

  it('a snoozed status without a time counts from the due time', () => {
    expect(ladderBase(input({ status: 'SNOOZED' }))).toEqual(DUE);
  });
});

describe('edges', () => {
  it('waits before the due time, and a closed dose never moves', () => {
    expect(kind({ now: t(-1) })).toBe('WAIT');
    expect(kind({ stage: 'CLOSED', now: t(500) })).toBe('WAIT');
    expect(kind({ stage: 'CLOSED', status: 'TAKEN' })).toBe('WAIT');
  });

  it.each(['TAKEN', 'TAKEN_LATE', 'SKIPPED', 'MISSED'] as const)(
    '%s with an open stage closes',
    (status) => {
      expect(kind({ status, stage: 'REMINDED', now: t(5) })).toBe('CLOSE');
    },
  );

  it('does not repeat a reminder already sent', () => {
    expect(kind({ stage: 'REMINDED', now: t(5) })).toBe('WAIT');
    expect(kind({ stage: 'REPEATED', now: t(20) })).toBe('WAIT');
    expect(kind({ stage: 'REMINDED', now: t(5), isCritical: true })).toBe('WAIT');
    expect(kind({ stage: 'REPEATED', now: t(20), isCritical: true })).toBe('WAIT');
  });
});
