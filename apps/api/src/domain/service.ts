import { randomUUID } from 'node:crypto';
import { normalizeBdMsisdn } from '@uposhom/applink-client';
import {
  DEFAULT_ANCHORS,
  ScheduleInputError,
  addDays,
  dhakaMidnight,
  generateSchedule,
  toDhakaDate,
  toDhakaIso,
  type ItemSchedule,
} from '@uposhom/schedule-engine';
import type {
  CircleResponse,
  ConfirmItem,
  ConfirmResponse,
  Dose,
  DoseActionBody,
  DoseActionResponse,
  LinkRole,
  AgentTrace,
  AlertItem,
  Profile,
  ProfileLink,
  TodayDosesResponse,
} from '@uposhom/shared';
import type { DoseReplyCode } from '../ports.js';
import { DomainError } from './errors.js';
import { isExpoPushToken } from './push.js';
import type {
  ActionChannel,
  DomainStore,
  DoseLogAction,
  DosePatch,
  DoseRecord,
  DoseView,
  MealAnchors,
  PrescriptionItemRecord,
  ProfileRecord,
  AppointmentRecord,
} from './types.js';

export interface AppointmentView {
  id: string;
  title: string;
  dueAt: string;
  reminderState: AppointmentRecord['reminderState'];
}

const appointmentView = (a: AppointmentRecord): AppointmentView => ({
  id: a.id,
  title: a.title,
  dueAt: toDhakaIso(a.dueAt.getTime()),
  reminderState: a.reminderState,
});

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Rules in one place, so the mentor and pharmacist review can see and change them. */
export const DOSE_RULES = {
  /** A dose taken more than this after it was due is recorded as taken late. */
  lateAfterMinutes: 30,
  /** Actions on a dose are refused until this close to its due time. */
  actableBeforeMinutes: 120,
  snoozeDefaultMinutes: 15,
  snoozeMinMinutes: 5,
  snoozeMaxMinutes: 60,
  /** Adherence looks back this far. */
  adherenceDays: 30,
  /** An SMS reply applies to the latest dose due within this window. */
  smsReplyWindowMinutes: 6 * 60,
  maxTodayDays: 14,
} as const;

export const PROFILE_LIMITS = { free: 1, premium: 7 } as const; // premium: the admin plus 6
export const LINK_LIMITS = { perProfile: 10, inviteDays: 7 } as const;

export interface DomainServiceDeps {
  store: DomainStore;
  now: () => Date;
  /** From A's subscription service: whether the user has an active Premium plan. */
  isPremium: (userId: string) => Promise<boolean>;
  /** From A's user store: the user whose number has this opaque subscriber id. */
  findUserIdBySubscriber: (subscriberId: string) => Promise<string | null>;
  /** From A's user store. `msisdn` is normalised, 8801XXXXXXXXX. */
  findUser: (userId: string) => Promise<{ id: string; msisdn: string; isAdmin: boolean } | null>;
  findUserIdByMsisdn: (msisdn: string) => Promise<string | null>;
  /** A's keyed lookup hash of a normalised number (security/phone-crypto.ts). */
  phoneKey: (msisdn: string) => string;
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

/** The default name of a new user's own profile ('me'): useless to anyone else. */
const SELF_NAME = 'আমি';
const latinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
/** 8801959979376 -> 019****9376, the way the app shows numbers elsewhere. */
const maskLocal = (msisdn: string) => {
  const local = `0${msisdn.slice(3)}`;
  return `${local.slice(0, 3)}****${local.slice(-4)}`;
};

// ---------------------------------------------------------------- Bangla text

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export const toBn = (value: number | string): string =>
  String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);

const SLOT_BN: Record<string, string> = {
  MORNING: 'সকালে',
  NOON: 'দুপুরে',
  EVENING: 'বিকেলে',
  NIGHT: 'রাতে',
  BEDTIME: 'ঘুমানোর আগে',
  STAT: 'এখনই',
};
const MEAL_BN: Record<string, string> = {
  AC: 'খাবারের আগে',
  PC: 'খাবারের পরে',
  WITH_MEAL: 'খাবারের সাথে',
  NONE: '',
};

/** One deterministic Bangla line per confirmed prescription. No model is involved. */
export function banglaSummary(
  items: Array<{ brandName: string; mealRelation: string }>,
  schedules: ItemSchedule[],
): string {
  const parts = items.map((item, i) => {
    const s = schedules[i]!;
    if (s.status === 'AS_NEEDED') return `${item.brandName} প্রয়োজনে`;
    if (s.status !== 'SCHEDULED') return item.brandName;
    // 'সকালে ও রাতে', 'সকালে, দুপুরে ও রাতে'
    const names = s.slots.map((slot) => SLOT_BN[slot]!);
    const when =
      names.length > 1 ? `${names.slice(0, -1).join(', ')} ও ${names[names.length - 1]}` : names[0];
    return [item.brandName, when, s.slots[0] === 'STAT' ? '' : MEAL_BN[item.mealRelation]]
      .filter(Boolean)
      .join(' ');
  });
  return `আপনার প্রেসক্রিপশনের জন্য মোট ${toBn(items.length)}টি ওষুধ শিডিউল করা হয়েছে। ${parts.join('; ')}।`;
}

function displayTime(ms: number): string {
  const iso = toDhakaIso(ms);
  const h = Number(iso.slice(11, 13));
  const m = iso.slice(14, 16);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function doseDto(d: DoseView): Dose {
  const taken = d.status === 'TAKEN' || d.status === 'TAKEN_LATE';
  return {
    id: d.id,
    time: displayTime(d.dueAt.getTime()),
    dueAt: toDhakaIso(d.dueAt.getTime()),
    medicine: [d.brandName, d.strength].filter(Boolean).join(' '),
    ...(d.form ? { form: d.form } : {}),
    instructions: [SLOT_BN[d.slot], MEAL_BN[d.mealRelation]].filter(Boolean).join(', '),
    status: d.status,
    takenAt: taken && d.actedAt ? toDhakaIso(d.actedAt.getTime()) : null,
    isCritical: d.isCritical,
    ...(d.strength ? { strength: d.strength } : {}),
    mealRelation: d.mealRelation,
    profileId: d.profileId,
  };
}

// ---------------------------------------------------------------- adherence

const isTaken = (d: DoseRecord) => d.status === 'TAKEN' || d.status === 'TAKEN_LATE';

/**
 * Percent of decided doses taken over the look-back window. A dose counts once it is past due by
 * the late threshold; skipped doses are left out (a skip with a reason is not a lapse). Null when
 * nothing has come due yet.
 */
export function adherenceRate(doses: DoseRecord[], now: Date): number | null {
  const cutoff = now.getTime() - DOSE_RULES.lateAfterMinutes * MINUTE;
  const counted = doses.filter(
    (d) => d.status !== 'SKIPPED' && (isTaken(d) || d.dueAt.getTime() <= cutoff),
  );
  if (counted.length === 0) return null;
  return Math.round((counted.filter(isTaken).length / counted.length) * 1000) / 10;
}

const missedCritical = (doses: DoseRecord[], now: Date) => {
  const cutoff = now.getTime() - DOSE_RULES.lateAfterMinutes * MINUTE;
  const since = now.getTime() - DAY;
  return doses.some(
    (d) =>
      d.isCritical &&
      d.dueAt.getTime() >= since &&
      (d.status === 'MISSED' ||
        ((d.status === 'SCHEDULED' || d.status === 'SNOOZED') && d.dueAt.getTime() <= cutoff)),
  );
};

// ---------------------------------------------------------------- validation

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function checkMealTimes(m: MealAnchors): void {
  const list = [m.morning, m.noon, m.evening, m.night];
  if (!list.every((t) => CLOCK.test(t))) {
    throw new DomainError('INVALID_INPUT', 400, { message: 'MEAL_TIME_FORMAT' });
  }
  for (let i = 1; i < list.length; i++) {
    if (list[i]! <= list[i - 1]!) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'MEAL_TIME_ORDER' });
    }
  }
}

function checkQuietHours(q: { start: string; end: string }): void {
  if (!CLOCK.test(q.start) || !CLOCK.test(q.end)) {
    throw new DomainError('INVALID_INPUT', 400, { message: 'QUIET_HOURS_FORMAT' });
  }
}

const WRITE_ROLES: ReadonlySet<LinkRole> = new Set(['ADMIN', 'CAREGIVER']);

// ---------------------------------------------------------------- the service

export function createDomainService(deps: DomainServiceDeps) {
  const { store } = deps;

  async function ensureCircle(userId: string) {
    const found = await deps.store.circles.findByOwner(userId);
    if (found) return found;
    const now = deps.now();
    const circle = { id: newId('cir'), ownerUserId: userId, createdAt: now };
    const self: ProfileRecord = {
      id: newId('prf'),
      circleId: circle.id,
      userId,
      name: 'আমি',
      relationship: 'SELF',
      age: null,
      allergies: null,
      mealTimes: { ...DEFAULT_ANCHORS },
      quietHours: null,
      subscriberId: null,
      smsTag: null,
      createdAt: now,
    };
    try {
      await store.circles.createWithSelf({
        circle,
        self,
        link: {
          id: newId('lnk'),
          userId,
          profileId: self.id,
          role: 'ADMIN',
          isSecondaryCaregiver: false,
          createdAt: now,
        },
      });
      return circle;
    } catch (err) {
      // Two first requests at once: the other one created it.
      const again = await store.circles.findByOwner(userId);
      if (again) return again;
      throw err;
    }
  }

  /** The profile, if the user has a link to it. Writing needs ADMIN or CAREGIVER. */
  async function access(userId: string, profileId: string, write: boolean) {
    const role = await store.profiles.roleOf(userId, profileId);
    const profile = role ? await store.profiles.findById(profileId) : null;
    // No link and no such profile look the same: a profile id reveals nothing.
    if (!role || !profile) throw new DomainError('NOT_FOUND', 404);
    if (write && !WRITE_ROLES.has(role)) throw new DomainError('FORBIDDEN', 403);
    return { profile, role };
  }

  async function recentDoses(profileId: string, now: Date) {
    return store.doses.listForProfile(
      profileId,
      new Date(now.getTime() - DOSE_RULES.adherenceDays * DAY),
      new Date(now.getTime() + 1),
    );
  }

  async function profileDto(profile: ProfileRecord, role: LinkRole): Promise<Profile> {
    const now = deps.now();
    const doses = await recentDoses(profile.id, now);
    return {
      id: profile.id,
      name: profile.name,
      relationship: profile.relationship,
      age: profile.age,
      adherenceRate: adherenceRate(doses, now),
      status: missedCritical(doses, now) ? 'MISSED_CRITICAL' : 'OK',
      ...(profile.allergies ? { allergies: profile.allergies } : {}),
      mealTimes: profile.mealTimes,
      ...(profile.quietHours ? { quietHours: profile.quietHours } : {}),
      phoneLinked: profile.subscriberId !== null,
      links: await linkDtos(profile),
      myRole: role,
    };
  }

  /** What the app shows for each person linked to a profile. Never a full number. */
  async function linkDtos(profile: ProfileRecord): Promise<ProfileLink[]> {
    const out: ProfileLink[] = [];
    for (const l of await store.profiles.linksOf(profile.id)) {
      const own = (await store.profiles.listForUser(l.userId)).find(
        (x) => x.profile.userId === l.userId,
      )?.profile.name;
      const user = await deps.findUser(l.userId);
      const name = own && own !== SELF_NAME ? own : user ? maskLocal(user.msisdn) : '—';
      out.push({
        id: l.id,
        userId: l.userId,
        name,
        role: l.role,
        isSecondaryCaregiver: l.isSecondaryCaregiver,
      });
    }
    return out;
  }

  /**
   * Open invites for the signed-in user's number become links. Signing in with an OTP to that
   * number is the proof and the consent, so this runs whenever the app loads the circle.
   */
  async function acceptInvites(userId: string): Promise<void> {
    const user = await deps.findUser(userId);
    if (!user) return;
    const now = deps.now();
    for (const invite of await store.invites.openForPhone(deps.phoneKey(user.msisdn), now)) {
      await store.invites.accept(
        invite.id,
        {
          id: newId('lnk'),
          userId,
          profileId: invite.profileId,
          role: invite.role,
          isSecondaryCaregiver: false,
          createdAt: now,
        },
        now,
      );
    }
  }

  /** The link, its profile, and the caller's role there. NOT_FOUND unless the caller is linked. */
  async function linkContext(userId: string, linkId: string) {
    const link = await store.links.findById(linkId);
    if (!link) throw new DomainError('NOT_FOUND', 404);
    const { profile, role } = await access(userId, link.profileId, false);
    return { link, profile, callerRole: role };
  }

  const adminsOf = async (profileId: string) =>
    (await store.profiles.linksOf(profileId)).filter((l) => l.role === 'ADMIN');

  /** POST /links: invite someone, by number, to a profile the caller administers. */
  async function invite(
    userId: string,
    body: { profileId: string; msisdn: string; role: LinkRole },
  ): Promise<{ success: boolean }> {
    const { role } = await access(userId, body.profileId, true);
    if (role !== 'ADMIN') throw new DomainError('FORBIDDEN', 403);
    const msisdn = normalizeBdMsisdn(latinDigits(body.msisdn));
    if (!msisdn) throw new DomainError('INVALID_INPUT', 400, { message: 'MSISDN' });
    const me = await deps.findUser(userId);
    if (me?.msisdn === msisdn) throw new DomainError('INVALID_INPUT', 400, { message: 'SELF' });

    const links = await store.profiles.linksOf(body.profileId);
    const existing = await deps.findUserIdByMsisdn(msisdn);
    if (existing && links.some((l) => l.userId === existing)) {
      throw new DomainError('ALREADY_LINKED', 409);
    }
    const now = deps.now();
    const open = await store.invites.openForProfile(body.profileId, now);
    if (links.length + open.length >= LINK_LIMITS.perProfile) {
      throw new DomainError('LIMIT_REACHED', 409);
    }
    // A repeated invite for the same number is fine: the open one stands.
    await store.invites.create({
      id: newId('inv'),
      profileId: body.profileId,
      invitedBy: userId,
      phoneKey: deps.phoneKey(msisdn),
      role: body.role,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LINK_LIMITS.inviteDays * DAY),
      acceptedAt: null,
      acceptedBy: null,
    });
    return { success: true };
  }

  /** PUT /links/:id: an admin changes someone's role. */
  async function changeRole(
    userId: string,
    linkId: string,
    role: LinkRole,
  ): Promise<{ success: boolean }> {
    const { link, profile, callerRole } = await linkContext(userId, linkId);
    if (callerRole !== 'ADMIN') throw new DomainError('FORBIDDEN', 403);
    if (link.userId === profile.userId) throw new DomainError('OWN_PROFILE', 409);
    if (link.role === 'ADMIN' && role !== 'ADMIN' && (await adminsOf(profile.id)).length <= 1) {
      throw new DomainError('LAST_ADMIN', 409);
    }
    await store.links.setRole(linkId, role);
    // A viewer cannot be the one who gets the escalation.
    if (role === 'VIEWER' && link.isSecondaryCaregiver)
      await store.links.setSecondary(profile.id, '');
    return { success: true };
  }

  /** DELETE /links/:id (after a step-up OTP): an admin removes someone, or anyone leaves. */
  async function removeLink(userId: string, linkId: string): Promise<{ success: boolean }> {
    const { link, profile, callerRole } = await linkContext(userId, linkId);
    const leaving = link.userId === userId;
    if (!leaving && callerRole !== 'ADMIN') throw new DomainError('FORBIDDEN', 403);
    if (link.userId === profile.userId) throw new DomainError('OWN_PROFILE', 409);
    if (link.role === 'ADMIN' && (await adminsOf(profile.id)).length <= 1) {
      throw new DomainError('LAST_ADMIN', 409);
    }
    await store.links.remove(linkId);
    return { success: true };
  }

  /** PUT /profiles/:id/secondary-caregiver: who gets the T+50 alert. */
  async function setSecondary(
    userId: string,
    profileId: string,
    linkId: string,
  ): Promise<{ success: boolean }> {
    const { role, profile } = await access(userId, profileId, true);
    if (role !== 'ADMIN') throw new DomainError('FORBIDDEN', 403);
    const link = await store.links.findById(linkId);
    if (!link || link.profileId !== profileId) throw new DomainError('NOT_FOUND', 404);
    if (!WRITE_ROLES.has(link.role) || link.userId === profile.userId) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'NOT_A_CAREGIVER' });
    }
    await store.links.setSecondary(profileId, linkId);
    return { success: true };
  }

  async function getCircle(userId: string): Promise<CircleResponse> {
    await acceptInvites(userId);
    const circle = await ensureCircle(userId);
    const premium = await deps.isPremium(userId);
    const linked = await store.profiles.listForUser(userId);
    return {
      circle: {
        id: circle.id,
        tier: premium ? 'PREMIUM' : 'FREE',
        memberCount: await store.profiles.countInCircle(circle.id),
        maxProfiles: premium ? PROFILE_LIMITS.premium : PROFILE_LIMITS.free,
      },
      profiles: await Promise.all(linked.map((l) => profileDto(l.profile, l.role))),
    };
  }

  async function createProfile(
    userId: string,
    body: { name: string; relationship: string; age?: number; mealTimes?: MealAnchors },
  ): Promise<Profile> {
    const circle = await ensureCircle(userId);
    const limit = (await deps.isPremium(userId)) ? PROFILE_LIMITS.premium : PROFILE_LIMITS.free;
    if ((await store.profiles.countInCircle(circle.id)) >= limit) {
      throw new DomainError('PAYMENT_REQUIRED', 402, { message: 'PREMIUM' });
    }
    const name = body.name.trim();
    if (!name || name.length > 60 || !body.relationship.trim()) {
      throw new DomainError('INVALID_INPUT', 400);
    }
    if (
      body.age !== undefined &&
      !(Number.isInteger(body.age) && body.age >= 0 && body.age <= 130)
    ) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'AGE' });
    }
    const mealTimes = body.mealTimes ?? { ...DEFAULT_ANCHORS };
    checkMealTimes(mealTimes);
    const now = deps.now();
    const profile: ProfileRecord = {
      id: newId('prf'),
      circleId: circle.id,
      userId: null,
      name,
      relationship: body.relationship.trim().toUpperCase(),
      age: body.age ?? null,
      allergies: null,
      mealTimes,
      quietHours: null,
      subscriberId: null,
      smsTag: null,
      createdAt: now,
    };
    await store.profiles.create(profile, {
      id: newId('lnk'),
      userId,
      profileId: profile.id,
      role: 'ADMIN',
      isSecondaryCaregiver: false,
      createdAt: now,
    });
    return profileDto(profile, 'ADMIN');
  }

  async function updateProfile(
    userId: string,
    profileId: string,
    body: {
      name?: string;
      relationship?: string;
      age?: number;
      allergies?: string;
      mealTimes?: MealAnchors;
      quietHours?: { start: string; end: string };
    },
  ): Promise<Profile> {
    const { role } = await access(userId, profileId, true);
    if (body.mealTimes) checkMealTimes(body.mealTimes);
    if (body.quietHours) checkQuietHours(body.quietHours);
    if (body.name !== undefined && (!body.name.trim() || body.name.length > 60)) {
      throw new DomainError('INVALID_INPUT', 400);
    }
    const updated = await store.profiles.update(profileId, {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.relationship !== undefined ? { relationship: body.relationship.toUpperCase() } : {}),
      ...(body.age !== undefined ? { age: body.age } : {}),
      ...(body.allergies !== undefined ? { allergies: body.allergies } : {}),
      ...(body.mealTimes ? { mealTimes: body.mealTimes } : {}),
      ...(body.quietHours ? { quietHours: body.quietHours } : {}),
    });
    if (!updated) throw new DomainError('NOT_FOUND', 404);
    return profileDto(updated, role);
  }

  /**
   * The human confirmation gate (Master Plan 15.2): the confirmed items go through the schedule
   * engine and are saved with their doses in one transaction. `prescriptionId` is a draft from
   * upload-and-parse, or 'new' for a typed-in prescription. If any item cannot be scheduled
   * exactly, nothing is saved and the reasons go back to the confirm screen.
   */
  async function confirm(
    userId: string,
    prescriptionId: string,
    body: { profileId: string; items: ConfirmItem[] },
  ): Promise<ConfirmResponse> {
    const { profile } = await access(userId, body.profileId, true);
    if (body.items.length === 0 || body.items.length > 20) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'ITEM_COUNT' });
    }

    let id = prescriptionId;
    let createdAt = deps.now();
    if (prescriptionId === 'new') {
      id = newId('pre');
    } else {
      const existing = await store.prescriptions.findById(prescriptionId);
      if (!existing || existing.profileId !== profile.id) throw new DomainError('NOT_FOUND', 404);
      if (existing.status !== 'DRAFT') throw new DomainError('ALREADY_CONFIRMED', 409);
      createdAt = existing.createdAt;
    }

    const now = deps.now();
    const startDate = toDhakaDate(now.getTime());
    const itemIds = body.items.map(() => newId('itm'));
    let schedule;
    try {
      schedule = generateSchedule({
        items: body.items.map((item, i) => ({
          key: itemIds[i]!,
          pattern: item.parsedPattern,
          mealRelation: item.mealRelation,
          durationDays: item.durationDays,
          isCritical: item.isCritical,
          ...(item.pillCount !== undefined ? { pillCount: item.pillCount } : {}),
        })),
        anchors: profile.mealTimes,
        startDate,
        now: now.getTime(),
      });
    } catch (err) {
      // Bad meal times on the profile: the profile screen must fix them first.
      if (err instanceof ScheduleInputError) {
        throw new DomainError('INVALID_INPUT', 400, { message: err.code });
      }
      throw err;
    }

    if (schedule.needsManualInput) {
      throw new DomainError('NEEDS_MANUAL_INPUT', 422, {
        details: schedule.items.flatMap((s, index) =>
          s.status === 'NEEDS_MANUAL_INPUT' ? [{ index, reasons: s.reasons }] : [],
        ),
      });
    }

    const items: PrescriptionItemRecord[] = body.items.map((item, i) => {
      const s = schedule.items[i]!;
      return {
        id: itemIds[i]!,
        prescriptionId: id,
        position: i,
        brandName: item.brandName.trim(),
        strength: item.dosageStrength.trim() || null,
        form: item.form.trim() || null,
        parsedPattern: item.parsedPattern,
        mealRelation: item.mealRelation,
        durationDays: s.status === 'AS_NEEDED' ? null : item.durationDays,
        pillCount: item.pillCount ?? null,
        asNeeded: s.status === 'AS_NEEDED',
        isCritical: item.isCritical,
        courseEndsOn: s.status === 'SCHEDULED' ? s.courseEndsOn : null,
        refillDueOn: s.status === 'SCHEDULED' ? s.refillDueOn : null,
      };
    });

    const doses: DoseRecord[] = schedule.events.map((e) => ({
      id: newId('dose'),
      profileId: profile.id,
      prescriptionItemId: e.itemKey,
      idempotencyKey: e.key,
      courseDate: e.courseDate,
      slot: e.slot,
      quantity: e.quantity,
      mealRelation: e.mealRelation,
      dueAt: new Date(e.dueAtMs),
      isCritical: e.isCritical,
      status: 'SCHEDULED',
      stage: 'PENDING',
      snoozedUntil: null,
      actedAt: null,
    }));

    await store.prescriptions.saveConfirmed({
      prescription: {
        id,
        profileId: profile.id,
        status: 'CONFIRMED',
        startDate,
        createdBy: userId,
        confirmedBy: userId,
        confirmedAt: now,
        createdAt,
      },
      items,
      doses,
    });

    return {
      prescriptionId: id,
      status: 'CONFIRMED',
      scheduledEventsCount: doses.length,
      firstDoseAt: schedule.events[0]?.dueAt ?? null,
      banglaSummary: banglaSummary(body.items, schedule.items),
    };
  }

  /** The timeline for a profile: doses due from today's Dhaka midnight for `days` days. */
  async function today(
    userId: string,
    opts: { profileId?: string; days?: number },
  ): Promise<TodayDosesResponse> {
    let profileId = opts.profileId;
    if (!profileId) {
      await ensureCircle(userId);
      const linked = await store.profiles.listForUser(userId);
      profileId = (linked.find((l) => l.profile.userId === userId) ?? linked[0])?.profile.id;
      if (!profileId) throw new DomainError('NOT_FOUND', 404);
    }
    await access(userId, profileId, false);
    const days = opts.days ?? 1;
    if (!Number.isInteger(days) || days < 1 || days > DOSE_RULES.maxTodayDays) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'DAYS' });
    }
    const now = deps.now();
    const date = toDhakaDate(now.getTime());
    const from = dhakaMidnight(date)!;
    const list = await store.doses.listForProfile(
      profileId,
      new Date(from),
      new Date(addDays(from, days)),
    );
    return {
      date,
      timezone: 'Asia/Dhaka',
      doses: list.map(doseDto),
      adherenceRate: adherenceRate(await recentDoses(profileId, now), now),
    };
  }

  /** Taken, snooze or skip, from the app, a notification button, or an SMS reply. */
  async function applyAction(
    dose: DoseView,
    body: DoseActionBody,
    channel: ActionChannel,
    actorUserId: string | null,
  ): Promise<DoseRecord> {
    const now = deps.now();
    if (dose.dueAt.getTime() - now.getTime() > DOSE_RULES.actableBeforeMinutes * MINUTE) {
      throw new DomainError('DOSE_NOT_DUE', 409);
    }

    const closed =
      dose.status === 'TAKEN' || dose.status === 'TAKEN_LATE' || dose.status === 'SKIPPED';
    if (closed) {
      // Repeating the same answer (a double tap, a resent SMS) is fine and changes nothing.
      const same =
        (body.action === 'TAKEN' && isTaken(dose)) ||
        (body.action === 'SKIP' && dose.status === 'SKIPPED');
      if (same) return dose;
      throw new DomainError('DOSE_CLOSED', 409);
    }

    let patch: DosePatch;
    let action: DoseLogAction;
    let reason: string | null = null;
    if (body.action === 'TAKEN') {
      const late =
        dose.status === 'MISSED' ||
        now.getTime() - dose.dueAt.getTime() > DOSE_RULES.lateAfterMinutes * MINUTE;
      action = late ? 'TAKEN_LATE' : 'TAKEN';
      // Taking it closes the ladder: the worker cancels any pending alerts for a CLOSED dose.
      patch = { status: action, stage: 'CLOSED', actedAt: now, snoozedUntil: null };
    } else if (body.action === 'SNOOZE') {
      if (dose.status === 'MISSED') throw new DomainError('DOSE_CLOSED', 409);
      const minutes = body.snoozeMinutes ?? DOSE_RULES.snoozeDefaultMinutes;
      if (
        !Number.isInteger(minutes) ||
        minutes < DOSE_RULES.snoozeMinMinutes ||
        minutes > DOSE_RULES.snoozeMaxMinutes
      ) {
        throw new DomainError('INVALID_INPUT', 400, { message: 'SNOOZE_MINUTES' });
      }
      action = 'SNOOZE';
      // The ladder starts again from the end of the snooze (reminder, repeat, alert...).
      patch = {
        status: 'SNOOZED',
        stage: 'PENDING',
        snoozedUntil: new Date(now.getTime() + minutes * MINUTE),
      };
    } else {
      action = 'SKIP';
      reason = body.skipReason?.trim().slice(0, 200) || null;
      patch = { status: 'SKIPPED', stage: 'CLOSED', actedAt: now, snoozedUntil: null };
    }

    const updated = await store.doses.applyAction(dose.id, patch, {
      doseEventId: dose.id,
      action,
      channel,
      actorUserId,
      reason,
      at: now,
    });
    if (!updated) throw new DomainError('NOT_FOUND', 404);
    return updated;
  }

  async function act(
    userId: string,
    doseId: string,
    body: DoseActionBody,
    channel: Extract<ActionChannel, 'APP' | 'NOTIFICATION'> = 'APP',
  ): Promise<DoseActionResponse> {
    const dose = await store.doses.findById(doseId);
    if (!dose) throw new DomainError('NOT_FOUND', 404);
    await access(userId, dose.profileId, true);
    const updated = await applyAction(dose, body, channel, userId);
    const now = deps.now();
    return {
      success: true,
      doseId,
      newStatus: updated.status,
      updatedAdherenceRate: adherenceRate(await recentDoses(dose.profileId, now), now),
    };
  }

  /**
   * SMS reply codes (Master Plan 15.4), plugged into A's `doseReply` port. The sender is matched
   * by subscriber id: their own profile, any dependent profile on that number, and with a tag
   * (`UPOSHOM 1 A`) the linked profile carrying that tag. The reply applies to the most recently
   * due open dose. Never anything destructive. Replies are short: Bangla SMS parts are 70 chars.
   */
  async function smsReply(input: {
    subscriberId: string;
    code: DoseReplyCode;
    profileTag: string | null;
  }): Promise<{ replyText: string | null }> {
    const userId = await deps.findUserIdBySubscriber(input.subscriberId);
    const candidates = new Map<string, ProfileRecord>();
    for (const p of await store.profiles.findBySubscriberId(input.subscriberId)) {
      candidates.set(p.id, p);
    }
    if (userId) {
      for (const { profile, role } of await store.profiles.listForUser(userId)) {
        const own = profile.userId === userId;
        const tagged =
          input.profileTag !== null &&
          WRITE_ROLES.has(role) &&
          profile.smsTag?.toUpperCase() === input.profileTag;
        if (own || tagged) candidates.set(profile.id, profile);
      }
    }
    if (input.profileTag !== null) {
      for (const [id, p] of candidates) {
        if (p.smsTag?.toUpperCase() !== input.profileTag) candidates.delete(id);
      }
    }
    if (candidates.size === 0) return { replyText: null };

    const now = deps.now();
    const from = new Date(now.getTime() - DOSE_RULES.smsReplyWindowMinutes * MINUTE);
    const until = new Date(now.getTime() + 15 * MINUTE);
    let latest: DoseView | null = null;
    for (const id of candidates.keys()) {
      for (const d of await store.doses.listForProfile(id, from, until)) {
        const open = d.status === 'SCHEDULED' || d.status === 'SNOOZED' || d.status === 'MISSED';
        if (open && (!latest || d.dueAt > latest.dueAt)) latest = d;
      }
    }
    if (!latest) return { replyText: 'এখন কোনো ডোজ বাকি নেই।' };

    const action = input.code === 'TAKEN' ? 'TAKEN' : input.code === 'SNOOZE' ? 'SNOOZE' : 'SKIP';
    try {
      await applyAction(latest, { action }, 'SMS', userId);
    } catch (err) {
      if (err instanceof DomainError) return { replyText: 'এই ডোজটি আর বদলানো যাবে না।' };
      throw err;
    }
    const reply = {
      TAKEN: 'ধন্যবাদ, ওষুধ খাওয়া হয়েছে লেখা হলো।',
      SNOOZE: `ঠিক আছে, ${toBn(DOSE_RULES.snoozeDefaultMinutes)} মিনিট পরে আবার মনে করিয়ে দেব।`,
      SKIP: 'ঠিক আছে, এই ডোজটি বাদ দেওয়া হলো।',
    }[input.code];
    return { replyText: reply };
  }

  /** POST /devices: this phone can receive caregiver alerts by push. */
  async function registerDevice(
    userId: string,
    body: { expoPushToken: string; platform?: string },
  ): Promise<{ success: boolean }> {
    if (!isExpoPushToken(body.expoPushToken)) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'PUSH_TOKEN' });
    }
    const now = deps.now();
    await store.devices.upsert({
      id: newId('dev'),
      userId,
      expoToken: body.expoPushToken,
      platform:
        body.platform === 'android' || !body.platform ? 'android' : body.platform.slice(0, 20),
      createdAt: now,
      lastSeenAt: now,
    });
    return { success: true };
  }

  /** A caregiver saw the alert (app). Stops the secondary alert; the dose itself stays open. */
  async function acknowledge(userId: string, doseId: string): Promise<{ success: boolean }> {
    const dose = await store.doses.findById(doseId);
    if (!dose) throw new DomainError('NOT_FOUND', 404);
    await access(userId, dose.profileId, false);
    await store.escalations.acknowledge(doseId, deps.now(), 'APP');
    return { success: true };
  }

  /** The alerts inbox: caregiver alerts sent to this user in the last week, one per dose. */
  async function alerts(userId: string): Promise<{ alerts: AlertItem[] }> {
    const now = deps.now();
    const sent = await store.escalations.listForUser(userId, new Date(now.getTime() - 7 * DAY));
    const seen = new Set<string>();
    const out: AlertItem[] = [];
    for (const e of sent) {
      if (seen.has(e.doseEventId)) continue;
      seen.add(e.doseEventId);
      const dose = await store.doses.findById(e.doseEventId);
      const profile = dose ? await store.profiles.findById(dose.profileId) : null;
      if (!dose || !profile) continue;
      const open = dose.status === 'SCHEDULED' || dose.status === 'SNOOZED';
      const medicine = [dose.brandName, dose.strength].filter(Boolean).join(' ');
      out.push({
        id: e.idempotencyKey,
        type: 'MISSED_DOSE',
        createdAt: toDhakaIso(e.sentAt.getTime()),
        profileId: profile.id,
        profileName: profile.name,
        title: `${profile.name} জরুরি ওষুধ এখনও খাননি`,
        body: `${medicine}, ${displayTime(dose.dueAt.getTime())}`,
        doseId: dose.id,
        medicine,
        dueAt: toDhakaIso(dose.dueAt.getTime()),
        ...(open
          ? {
              overdueMinutes: Math.max(
                0,
                Math.floor((now.getTime() - dose.dueAt.getTime()) / MINUTE),
              ),
            }
          : {}),
        acknowledged: e.acknowledgedAt !== null,
        acknowledgedAt: e.acknowledgedAt ? toDhakaIso(e.acknowledgedAt.getTime()) : null,
      });
    }
    // Refill, follow-up and weekly digest notices share the inbox, newest first overall.
    for (const n of await store.notices.listForUser(userId, new Date(now.getTime() - 7 * DAY))) {
      const profile = await store.profiles.findById(n.profileId);
      if (!profile) continue;
      out.push({
        id: n.id,
        type: n.type,
        createdAt: toDhakaIso(n.createdAt.getTime()),
        profileId: profile.id,
        profileName: profile.name,
        title: n.title,
        body: n.body,
        acknowledged: n.acknowledgedAt !== null,
        acknowledgedAt: n.acknowledgedAt ? toDhakaIso(n.acknowledgedAt.getTime()) : null,
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { alerts: out };
  }

  /** POST /profiles/:id/appointments: a follow-up visit, reminded the day before. */
  async function addAppointment(
    userId: string,
    profileId: string,
    body: { title: string; dueAt: string },
  ): Promise<AppointmentView> {
    await access(userId, profileId, true);
    const title = body.title.trim();
    const due = /(Z|[+-]\d{2}:\d{2})$/.test(body.dueAt) ? Date.parse(body.dueAt) : Number.NaN;
    if (!title || title.length > 100)
      throw new DomainError('INVALID_INPUT', 400, { message: 'TITLE' });
    if (Number.isNaN(due) || due <= deps.now().getTime()) {
      throw new DomainError('INVALID_INPUT', 400, { message: 'DUE_AT' });
    }
    const row = {
      id: newId('apt'),
      profileId,
      title,
      dueAt: new Date(due),
      reminderState: 'PENDING' as const,
      createdAt: deps.now(),
    };
    await store.appointments.create(row);
    return appointmentView(row);
  }

  async function listAppointments(
    userId: string,
    profileId: string,
  ): Promise<{ appointments: AppointmentView[] }> {
    await access(userId, profileId, false);
    const since = new Date(deps.now().getTime() - DAY);
    return {
      appointments: (await store.appointments.listForProfile(profileId, since)).map(
        appointmentView,
      ),
    };
  }

  /**
   * GET /admin/traces: the agent-trace viewer. The admin flag is read from the account, not only
   * the token, and every read goes to the audit log, because traces can quote what people asked.
   */
  async function listTraces(userId: string, limit = 50): Promise<{ traces: AgentTrace[] }> {
    const user = await deps.findUser(userId);
    if (!user?.isAdmin) throw new DomainError('FORBIDDEN', 403);
    const n = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
    const rows = await store.traces.list(n);
    await store.audit.record({
      actorUserId: userId,
      action: 'READ_AGENT_TRACES',
      subjectType: 'agent_traces',
      subjectId: 'list',
      profileId: null,
      detail: { count: rows.length },
      at: deps.now(),
    });
    return {
      traces: rows.map((t) => ({
        id: t.id,
        createdAt: toDhakaIso(t.createdAt.getTime()),
        agent: t.rootAgent,
        ...(t.inputPreview ? { inputPreview: t.inputPreview } : {}),
        handoffs: t.handoffs,
        toolCalls: t.toolCalls,
        latencyMs: t.durationMs,
      })),
    };
  }

  /**
   * For workstream C's trace logger: one row per agent run. The preview is cut to 120 characters;
   * C decides what goes in it, and it should hold no phone numbers or names.
   */
  async function recordTrace(input: {
    userId?: string | null;
    profileId?: string | null;
    channel: 'APP' | 'SMS' | 'VOICE';
    rootAgent: string;
    inputPreview?: string | null;
    handoffs: Array<{ from: string; to: string }>;
    toolCalls: Array<{ name: string; durationMs: number }>;
    durationMs: number;
  }): Promise<string> {
    const id = newId('trc');
    await store.traces.record({
      id,
      userId: input.userId ?? null,
      profileId: input.profileId ?? null,
      channel: input.channel,
      rootAgent: input.rootAgent.slice(0, 60),
      inputPreview: input.inputPreview ? input.inputPreview.slice(0, 120) : null,
      handoffs: input.handoffs.slice(0, 50),
      toolCalls: input.toolCalls.slice(0, 100),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      createdAt: deps.now(),
    });
    return id;
  }

  return {
    getCircle,
    invite,
    changeRole,
    removeLink,
    setSecondary,
    createProfile,
    updateProfile,
    confirm,
    today,
    act,
    smsReply,
    acknowledge,
    registerDevice,
    addAppointment,
    listAppointments,
    listTraces,
    recordTrace,
    alerts,
    eraseUser: (userId: string) => store.eraseUser(userId),
  };
}

export type DomainService = ReturnType<typeof createDomainService>;
