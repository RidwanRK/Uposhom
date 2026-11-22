/**
 * Workstream B's scheduled jobs besides the dose ladder (Master Plan sections 3 and 18): refill
 * reminders, follow-up appointment reminders, and the weekly caregiver digest. Each run is safe to
 * repeat: every notice has a once-only `ref`, every SMS an idempotency key, and an appointment
 * moves to REMINDED with a compare-and-set.
 */
import { randomUUID } from 'node:crypto';
import { addDays, dhakaMidnight, toDhakaDate, toDhakaIso } from '@uposhom/schedule-engine';
import type { LinkRole } from '@uposhom/shared';
import { adherenceRate, toBn } from './service.js';
import type { DomainStore, NoticeType, ProfileRecord } from './types.js';

export const CARE_JOBS = {
  refills: { queue: 'job.care.refills', cron: '0 9 * * *' }, // 09:00 every day
  appointments: { queue: 'job.care.appointments', cron: '*/15 * * * *' },
  digest: { queue: 'job.care.digest', cron: '0 20 * * 5' }, // Friday 20:00, end of the Bangladeshi week
} as const;

export const CARE_RULES = {
  /** Remind this many days before the pills run out (and on the day). */
  refillDaysAhead: 2,
  /** Remind about a follow-up this long before it. */
  appointmentHoursAhead: 24,
  digestDays: 7,
} as const;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MONTHS_BN = [
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
const CARE_ROLES: ReadonlySet<LinkRole> = new Set(['ADMIN', 'CAREGIVER']);

/** '2026-11-24' -> '২৪ নভেম্বর' */
export const bnDate = (date: string): string =>
  `${toBn(Number(date.slice(8, 10)))} ${MONTHS_BN[Number(date.slice(5, 7)) - 1]}`;
const bnClock = (ms: number) => toBn(toDhakaIso(ms).slice(11, 16));
/** A new user's own profile is still called 'আমি' (me): useless to anyone else. */
const nameFor = (p: ProfileRecord) => (p.name === 'আমি' ? 'আপনার পরিবারের সদস্য' : p.name);

export interface CareJobDeps {
  store: DomainStore;
  now: () => Date;
  sendSms: (msg: {
    subscriberId: string;
    message: string;
    purpose: string;
    idempotencyKey: string;
  }) => Promise<void>;
  useSms: (userId: string) => Promise<{ allowed: boolean }>;
  subscriberOf: (userId: string) => Promise<string | null>;
  push: (msg: {
    userId: string;
    title: string;
    body: string;
    data: Record<string, string>;
    idempotencyKey: string;
  }) => Promise<void>;
  log: { info: (obj: object, msg: string) => void };
}

export function createCareJobs(deps: CareJobDeps) {
  const { store } = deps;

  /** People who look after the profile, including the patient themself when they are linked. */
  async function carers(profileId: string, includePatient: boolean, patientUserId: string | null) {
    return (await store.profiles.linksOf(profileId)).filter(
      (l) => CARE_ROLES.has(l.role) && (includePatient || l.userId !== patientUserId),
    );
  }

  async function notify(
    profile: ProfileRecord,
    userIds: string[],
    n: { type: NoticeType; title: string; body: string; ref: string },
  ): Promise<string[]> {
    const created: string[] = [];
    for (const userId of userIds) {
      const isNew = await store.notices.record({
        id: `ntc_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        userId,
        profileId: profile.id,
        type: n.type,
        title: n.title,
        body: n.body,
        ref: `${n.ref}:${userId}`,
        createdAt: deps.now(),
        acknowledgedAt: null,
      });
      if (isNew) created.push(userId);
    }
    return created;
  }

  /** The patient's own phone, by SMS, within the circle owner's monthly allowance. */
  async function smsPatient(profile: ProfileRecord, message: string, key: string, purpose: string) {
    const sub =
      profile.subscriberId ?? (profile.userId ? await deps.subscriberOf(profile.userId) : null);
    const circle = await store.circles.findById(profile.circleId);
    if (!sub || !circle) return;
    if (!(await deps.useSms(circle.ownerUserId)).allowed) return;
    await deps.sendSms({ subscriberId: sub, message, purpose, idempotencyKey: key });
  }

  /** Pills run out within two days: tell the patient and whoever looks after them. */
  async function refills(): Promise<{ items: number }> {
    const today = toDhakaDate(deps.now().getTime());
    const until = toDhakaDate(addDays(dhakaMidnight(today)!, CARE_RULES.refillDaysAhead));
    const due = await store.items.refillDueBetween(today, until);
    for (const { item, profileId } of due) {
      const profile = await store.profiles.findById(profileId);
      if (!profile || !item.refillDueOn) continue;
      const medicine = [item.brandName, item.strength].filter(Boolean).join(' ');
      const body = `${medicine} ${bnDate(item.refillDueOn)}-এ শেষ হবে। রিফিল করে নিন।`;
      const ref = `refill:${item.id}:${item.refillDueOn}`;
      const people = (await carers(profile.id, true, profile.userId)).map((l) => l.userId);
      await notify(profile, people, { type: 'REFILL_DUE', title: 'ওষুধ শেষ হয়ে আসছে', body, ref });
      await smsPatient(profile, `উপশম: ${body}`, ref, 'REFILL');
    }
    if (due.length) deps.log.info({ items: due.length }, 'refill reminders');
    return { items: due.length };
  }

  /** A follow-up in the next 24 hours: remind once. */
  async function appointments(): Promise<{ reminded: number }> {
    const now = deps.now();
    const due = await store.appointments.listPendingDue(
      now,
      new Date(now.getTime() + CARE_RULES.appointmentHoursAhead * HOUR),
    );
    let reminded = 0;
    for (const a of due) {
      if (!(await store.appointments.markReminded(a.id))) continue; // another run took it
      const profile = await store.profiles.findById(a.profileId);
      if (!profile) continue;
      const when = `${bnDate(toDhakaDate(a.dueAt.getTime()))} ${bnClock(a.dueAt.getTime())}`;
      const body = `${a.title}, ${when}।`;
      const ref = `followup:${a.id}`;
      const people = (await carers(profile.id, true, profile.userId)).map((l) => l.userId);
      await notify(profile, people, { type: 'FOLLOW_UP', title: 'ফলো-আপ অ্যাপয়েন্টমেন্ট', body, ref });
      await smsPatient(profile, `উপশম: ফলো-আপ ${body}`, ref, 'FOLLOW_UP');
      reminded++;
    }
    return { reminded };
  }

  /** Friday evening: each caregiver hears how the week went for each profile they look after. */
  async function digest(): Promise<{ profiles: number }> {
    const now = deps.now();
    const from = new Date(now.getTime() - CARE_RULES.digestDays * DAY);
    const week = toDhakaDate(now.getTime());
    let sent = 0;
    for (const profileId of await store.doses.profilesWithDoses(from, now)) {
      const profile = await store.profiles.findById(profileId);
      if (!profile) continue;
      const doses = await store.doses.listForProfile(profileId, from, now);
      const rate = adherenceRate(doses, now);
      if (rate === null) continue;
      const missed = doses.filter((d) => d.status === 'MISSED').length;
      const body =
        `এই সপ্তাহে ${nameFor(profile)} ${toBn(Math.round(rate))}% ওষুধ সময়মতো খেয়েছেন।` +
        (missed ? ` মিস: ${toBn(missed)}টি।` : '');
      const people = (await carers(profile.id, false, profile.userId)).map((l) => l.userId);
      const fresh = await notify(profile, people, {
        type: 'WEEKLY_DIGEST',
        title: 'সাপ্তাহিক সারসংক্ষেপ',
        body,
        ref: `digest:${profileId}:${week}`,
      });
      for (const userId of fresh) {
        await deps.push({
          userId,
          title: 'সাপ্তাহিক সারসংক্ষেপ',
          body,
          data: { type: 'WEEKLY_DIGEST', profileId },
          idempotencyKey: `push:digest:${profileId}:${week}:${userId}`,
        });
      }
      if (people.length) sent++;
    }
    return { profiles: sent };
  }

  return { refills, appointments, digest };
}

export type CareJobs = ReturnType<typeof createCareJobs>;
