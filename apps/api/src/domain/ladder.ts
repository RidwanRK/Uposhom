/**
 * The reminder and escalation ladder (Master Plan section 6 and flow 15.3), as a pure function:
 * given a dose, the time and what has been sent so far, it says the ONE next step. No clock, no
 * I/O, so every branch is unit-tested; the tick job (escalation-job.ts) applies the steps.
 *
 *   T+0   reminder SMS to the patient (the phone's own alarm fires too)
 *   T+15  one repeat SMS
 *   T+30  not critical: logged missed, goes to the weekly digest, no caregiver alert
 *         critical:     caregiver alert (SMS now, push when device tokens land)
 *   T+50  critical, nobody acknowledged: the secondary caregiver is alerted
 *   T+70  critical: the alert window is over, logged missed
 *
 * T is the due time, or the end of a snooze. A dose taken late at any point is taken late and the
 * ladder stops. After downtime the ladder catches up without sending stale messages: at T+40 a
 * never-reminded critical dose goes straight to the caregiver alert, not to a T+0 reminder.
 */
import type { DoseStage } from './types.js';
import type { DoseStatus } from '@uposhom/shared';

export const LADDER = {
  repeatAfter: 15,
  alertAfter: 30,
  secondaryAfter: 50,
  /** A caregiver alert always gets at least this long before the next rung. */
  minGap: 20,
  missAfterCritical: 70,
} as const;

const MINUTE = 60_000;

export interface LadderInput {
  status: DoseStatus;
  stage: DoseStage;
  dueAt: Date;
  snoozedUntil: Date | null;
  isCritical: boolean;
  now: Date;
  /** Premium and at least one caregiver to tell. Otherwise a critical dose follows the plain path. */
  canEscalate: boolean;
  hasSecondary: boolean;
  /** When the first caregiver alert went out, if one did. */
  primaryAlertedAt: Date | null;
  secondaryAlertedAt: Date | null;
  acknowledged: boolean;
  /** A reminder to the patient bounced (UNDELIVERABLE, EXPIRED, REJECTED): alert now. */
  deliveryFailed: boolean;
}

export type LadderStep =
  | { kind: 'WAIT' }
  | { kind: 'REMIND'; repeat: boolean; to: DoseStage }
  | { kind: 'ALERT_PRIMARY'; to: 'CAREGIVER_ALERTED' }
  | { kind: 'ALERT_SECONDARY'; to: 'SECONDARY_ALERTED' }
  | { kind: 'MISS'; to: 'CLOSED' }
  /** Already acted on (or missed) but the stage was not closed: just close it. */
  | { kind: 'CLOSE'; to: 'CLOSED' };

const WAIT: LadderStep = { kind: 'WAIT' };

/** The moment the ladder counts from: the end of a snooze, else the due time. */
export function ladderBase(i: Pick<LadderInput, 'status' | 'dueAt' | 'snoozedUntil'>): Date {
  return i.status === 'SNOOZED' && i.snoozedUntil ? i.snoozedUntil : i.dueAt;
}

export function nextStep(i: LadderInput): LadderStep {
  if (i.stage === 'CLOSED') return WAIT;
  if (i.status !== 'SCHEDULED' && i.status !== 'SNOOZED') return { kind: 'CLOSE', to: 'CLOSED' };

  const base = ladderBase(i).getTime();
  const now = i.now.getTime();
  const elapsed = (now - base) / MINUTE;
  if (elapsed < 0) return WAIT;

  const notYetAlerted = i.stage === 'PENDING' || i.stage === 'REMINDED' || i.stage === 'REPEATED';
  const escalating = i.isCritical && i.canEscalate;

  if (!escalating) {
    if (elapsed >= LADDER.alertAfter) return { kind: 'MISS', to: 'CLOSED' };
    if (elapsed >= LADDER.repeatAfter) {
      return i.stage === 'REPEATED' ? WAIT : { kind: 'REMIND', repeat: true, to: 'REPEATED' };
    }
    return i.stage === 'PENDING' ? { kind: 'REMIND', repeat: false, to: 'REMINDED' } : WAIT;
  }

  // Critical, with someone to tell.
  if (notYetAlerted) {
    // Past the whole window (the worker was down): an alert now would be about a stale dose.
    if (elapsed >= LADDER.missAfterCritical) return { kind: 'MISS', to: 'CLOSED' };
    if (elapsed >= LADDER.alertAfter || i.deliveryFailed) {
      return { kind: 'ALERT_PRIMARY', to: 'CAREGIVER_ALERTED' };
    }
    if (elapsed >= LADDER.repeatAfter) {
      return i.stage === 'REPEATED' ? WAIT : { kind: 'REMIND', repeat: true, to: 'REPEATED' };
    }
    return i.stage === 'PENDING' ? { kind: 'REMIND', repeat: false, to: 'REMINDED' } : WAIT;
  }

  const primaryAt = (i.primaryAlertedAt?.getTime() ?? base + LADDER.alertAfter * MINUTE) / MINUTE;
  const nowMin = now / MINUTE;
  const baseMin = base / MINUTE;

  if (i.stage === 'CAREGIVER_ALERTED') {
    const secondaryDue = Math.max(baseMin + LADDER.secondaryAfter, primaryAt + LADDER.minGap);
    if (!i.acknowledged && i.hasSecondary && nowMin >= secondaryDue) {
      return { kind: 'ALERT_SECONDARY', to: 'SECONDARY_ALERTED' };
    }
    // Acknowledged, or nobody further to tell: the window still runs to its end.
    const missAt = Math.max(baseMin + LADDER.missAfterCritical, primaryAt + 2 * LADDER.minGap);
    return nowMin >= missAt ? { kind: 'MISS', to: 'CLOSED' } : WAIT;
  }

  // SECONDARY_ALERTED
  const secondaryAt =
    (i.secondaryAlertedAt?.getTime() ?? base + LADDER.secondaryAfter * MINUTE) / MINUTE;
  const missAt = Math.max(baseMin + LADDER.missAfterCritical, secondaryAt + LADDER.minGap);
  return nowMin >= missAt ? { kind: 'MISS', to: 'CLOSED' } : WAIT;
}
