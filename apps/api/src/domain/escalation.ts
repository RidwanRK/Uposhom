import { toDhakaIso } from '@uposhom/schedule-engine';
import type { LinkRole } from '@uposhom/shared';
import { LADDER, ladderBase, nextStep } from './ladder.js';
import type {
  DomainStore,
  DoseRecord,
  EscalationLevel,
  LinkRecord,
  ProfileRecord,
} from './types.js';

/** pg-boss queue for the ladder. Every minute; one run at a time. */
export const LADDER_JOB = { queue: 'job.doses.ladder', cron: '* * * * *' } as const;
/** Doses looked at per run. A backlog drains over the next runs, oldest first. */
const BATCH = 500;
const MINUTE = 60_000;

export interface LadderDeps {
  store: DomainStore;
  now: () => Date;
  smsKeyword: string;
  /** A's SMS queue. Idempotent on the key: a re-run never sends twice. */
  sendSms: (msg: {
    subscriberId: string;
    message: string;
    purpose: 'REMINDER' | 'CAREGIVER_ALERT';
    idempotencyKey: string;
    deliveryReport?: boolean;
    critical?: boolean;
  }) => Promise<void>;
  /** A's SMS allowance for the circle owner (the Free tier has a monthly cap). */
  useSms: (userId: string) => Promise<{ allowed: boolean }>;
  isPremium: (userId: string) => Promise<boolean>;
  /** The opaque subscriber id of a user, from A's user store. */
  subscriberOf: (userId: string) => Promise<string | null>;
  findUserIdBySubscriber: (subscriberId: string) => Promise<string | null>;
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
  };
}

const CARE_ROLES: ReadonlySet<LinkRole> = new Set(['ADMIN', 'CAREGIVER']);
const BN = '০১২৩৪৫৬৭৮৯';
const bnClock = (ms: number) =>
  toDhakaIso(ms)
    .slice(11, 16)
    .replace(/\d/g, (d) => BN[Number(d)]!);

/**
 * Runs the ladder (ladder.ts) against stored doses: sends what each step says through A's SMS
 * queue, records caregiver alerts, and moves the dose's stage with a compare-and-set so that two
 * workers, or a retried job, never act on one rung twice. SMS go out before the stage moves, and
 * each has an idempotency key, so a crash in between re-sends nothing and skips nothing.
 *
 * Push notifications to caregivers come when the device-token endpoint lands; the phone's own
 * Notifee alarm already covers the patient at T+0 and T+15.
 */
export function createLadderRunner(deps: LadderDeps) {
  const { store, log } = deps;

  async function patientSubscriber(profile: ProfileRecord): Promise<string | null> {
    if (profile.subscriberId) return profile.subscriberId;
    return profile.userId ? deps.subscriberOf(profile.userId) : null;
  }

  async function alert(
    dose: DoseRecord,
    profile: ProfileRecord,
    medicine: string,
    level: EscalationLevel,
    targets: LinkRecord[],
  ): Promise<void> {
    const now = deps.now();
    const message =
      `উপশম: ${profile.name}-এর জরুরি ওষুধ ${medicine} (${bnClock(dose.dueAt.getTime())}) ` +
      'এখনও খাওয়া হয়নি। অ্যাপে দেখুন।';
    for (const t of targets) {
      const key = `${dose.id}:${level}:${t.userId}`;
      const created = await store.escalations.record({
        doseEventId: dose.id,
        level,
        notifiedUserId: t.userId,
        idempotencyKey: key,
        sentAt: now,
      });
      const sub = await deps.subscriberOf(t.userId);
      // Recorded first so the inbox shows it even when the SMS cannot go.
      if (sub) {
        await deps.sendSms({
          subscriberId: sub,
          message,
          purpose: 'CAREGIVER_ALERT',
          idempotencyKey: `alert:${key}`,
          critical: true,
        });
      }
      if (created) log.info({ dose: dose.id, level }, 'caregiver alerted');
    }
  }

  /** Moves one dose as far as the ladder says it should be now. */
  async function process(start: DoseRecord, opts: { deliveryFailed?: boolean } = {}) {
    const view = await store.doses.findById(start.id);
    const profile = view ? await store.profiles.findById(view.profileId) : null;
    const circle = profile ? await store.circles.findById(profile.circleId) : null;
    if (!view || !profile || !circle) return;

    const medicine = [view.brandName, view.strength].filter(Boolean).join(' ');
    const carers = (await store.profiles.linksOf(profile.id)).filter(
      (l) => CARE_ROLES.has(l.role) && l.userId !== profile.userId,
    );
    const primary = carers.filter((l) => !l.isSecondaryCaregiver);
    const secondary = carers.filter((l) => l.isSecondaryCaregiver);
    const canEscalate = primary.length > 0 && (await deps.isPremium(circle.ownerUserId));

    let dose: DoseRecord = start;
    for (let guard = 0; guard < 6; guard++) {
      const sent = await store.escalations.forDose(dose.id);
      const firstAt = (level: EscalationLevel) =>
        sent.find((e) => e.level === level)?.sentAt ?? null;
      const step = nextStep({
        status: dose.status,
        stage: dose.stage,
        dueAt: dose.dueAt,
        snoozedUntil: dose.snoozedUntil,
        isCritical: dose.isCritical,
        now: deps.now(),
        canEscalate,
        hasSecondary: secondary.length > 0,
        primaryAlertedAt: firstAt('PRIMARY'),
        secondaryAlertedAt: firstAt('SECONDARY'),
        acknowledged: sent.some((e) => e.acknowledgedAt !== null),
        deliveryFailed: opts.deliveryFailed === true,
      });
      if (step.kind === 'WAIT') return;

      if (step.kind === 'REMIND') {
        const sub = await patientSubscriber(profile);
        const allowed = sub ? (await deps.useSms(circle.ownerUserId)).allowed : false;
        if (sub && allowed) {
          const tag = profile.smsTag ? ` ${profile.smsTag}` : '';
          const kw = deps.smsKeyword;
          await deps.sendSms({
            subscriberId: sub,
            message:
              `উপশম: ${medicine} খাওয়ার সময় (${bnClock(ladderBase(dose).getTime())})। ` +
              `খেলে ${kw} 1${tag}, পরে ${kw} 2${tag}, বাদ ${kw} 3${tag}`,
            purpose: 'REMINDER',
            idempotencyKey: `remind:${dose.id}:${ladderBase(dose).getTime()}:${step.repeat ? 2 : 1}`,
            deliveryReport: true,
            critical: dose.isCritical,
          });
        } else if (sub) {
          log.info({ dose: dose.id }, 'reminder sms not sent: monthly allowance used');
        }
      } else if (step.kind === 'ALERT_PRIMARY') {
        await alert(dose, profile, medicine, 'PRIMARY', primary);
      } else if (step.kind === 'ALERT_SECONDARY') {
        await alert(dose, profile, medicine, 'SECONDARY', secondary);
      }

      const now = deps.now();
      const moved = await store.doses.advance(
        dose.id,
        { stage: dose.stage, status: dose.status },
        step.kind === 'MISS'
          ? { status: 'MISSED', stage: 'CLOSED' }
          : { status: dose.status, stage: step.to },
        step.kind === 'MISS'
          ? {
              doseEventId: dose.id,
              action: 'MISSED',
              channel: 'SYSTEM',
              actorUserId: null,
              reason: null,
              at: now,
            }
          : null,
      );
      // Someone else (a tap, an SMS reply, another worker) moved it first: their state wins.
      if (!moved) return;
      dose = moved;
    }
  }

  /** One pass over every dose that is due. Called every minute by the queue. */
  async function tick(): Promise<{ looked: number }> {
    const open = await store.doses.listOpen(deps.now(), BATCH);
    for (const dose of open) {
      try {
        await process(dose);
      } catch (err) {
        // One bad dose must not hold up everyone else's reminders.
        log.warn(
          { dose: dose.id, err: err instanceof Error ? err.name : 'unknown' },
          'ladder step failed',
        );
      }
    }
    return { looked: open.length };
  }

  /**
   * A reminder to a patient bounced (A's onSmsDeliveryFailure port). For a critical dose the
   * caregiver alert comes forward instead of waiting for T+30; other doses keep the normal path.
   */
  async function onDeliveryFailure(input: {
    subscriberId: string;
    purpose: string;
    critical: boolean;
  }) {
    if (input.purpose !== 'REMINDER' || !input.critical) return;
    const profiles = new Map<string, ProfileRecord>();
    for (const p of await store.profiles.findBySubscriberId(input.subscriberId))
      profiles.set(p.id, p);
    const userId = await deps.findUserIdBySubscriber(input.subscriberId);
    if (userId) {
      for (const { profile } of await store.profiles.listForUser(userId)) {
        if (profile.userId === userId) profiles.set(profile.id, profile);
      }
    }
    const now = deps.now();
    const from = new Date(now.getTime() - LADDER.missAfterCritical * MINUTE);
    for (const id of profiles.keys()) {
      for (const d of await store.doses.listForProfile(id, from, new Date(now.getTime() + 1))) {
        const early = d.stage === 'PENDING' || d.stage === 'REMINDED' || d.stage === 'REPEATED';
        if (d.isCritical && early) await process(d, { deliveryFailed: true });
      }
    }
  }

  return { tick, process, onDeliveryFailure };
}

export type LadderRunner = ReturnType<typeof createLadderRunner>;
