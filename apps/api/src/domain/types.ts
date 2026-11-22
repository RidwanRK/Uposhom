/**
 * Persistence for workstream B's domain (circles, profiles, prescriptions, doses). Same idea as
 * A's src/stores: an in-memory implementation for development and tests, and a Postgres one over
 * the Drizzle schema in packages/db. Nothing outside src/domain knows which is in use, and
 * test/domain-contract.ts holds both to the same behaviour.
 */
import type { DoseStatus, LinkRole, MealRelation } from '@uposhom/shared';

export interface MealAnchors {
  morning: string;
  noon: string;
  evening: string;
  night: string;
}

export interface CircleRecord {
  id: string;
  ownerUserId: string;
  createdAt: Date;
}

export interface ProfileRecord {
  id: string;
  circleId: string;
  /** Set when this is the signed-in user's own profile. */
  userId: string | null;
  name: string;
  relationship: string;
  age: number | null;
  allergies: string | null;
  mealTimes: MealAnchors;
  quietHours: { start: string; end: string } | null;
  /** Opaque Applink id from a Family Link verify. Never sent to the app. */
  subscriberId: string | null;
  smsTag: string | null;
  createdAt: Date;
}

export interface LinkRecord {
  id: string;
  userId: string;
  profileId: string;
  role: LinkRole;
  isSecondaryCaregiver: boolean;
  createdAt: Date;
}

export type PrescriptionStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface PrescriptionRecord {
  id: string;
  profileId: string;
  status: PrescriptionStatus;
  startDate: string | null;
  createdBy: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
}

export interface PrescriptionItemRecord {
  id: string;
  prescriptionId: string;
  position: number;
  brandName: string;
  strength: string | null;
  form: string | null;
  parsedPattern: string;
  mealRelation: MealRelation;
  durationDays: number | null;
  pillCount: number | null;
  asNeeded: boolean;
  isCritical: boolean;
  courseEndsOn: string | null;
  refillDueOn: string | null;
}

export type DoseSlot = 'MORNING' | 'NOON' | 'EVENING' | 'NIGHT' | 'BEDTIME' | 'STAT';
export type DoseStage =
  'PENDING' | 'REMINDED' | 'REPEATED' | 'CAREGIVER_ALERTED' | 'SECONDARY_ALERTED' | 'CLOSED';

export interface DoseRecord {
  id: string;
  profileId: string;
  prescriptionItemId: string;
  idempotencyKey: string;
  courseDate: string;
  slot: DoseSlot;
  quantity: number;
  mealRelation: MealRelation;
  dueAt: Date;
  isCritical: boolean;
  status: DoseStatus;
  stage: DoseStage;
  snoozedUntil: Date | null;
  actedAt: Date | null;
}

/** A dose with the medicine it is for, for timelines. */
export interface DoseView extends DoseRecord {
  brandName: string;
  strength: string | null;
  form: string | null;
}

export type DoseLogAction = 'TAKEN' | 'TAKEN_LATE' | 'SNOOZE' | 'SKIP' | 'MISSED';
export type ActionChannel = 'APP' | 'NOTIFICATION' | 'SMS' | 'CAREGIVER' | 'SYSTEM';

export interface DoseLogRecord {
  doseEventId: string;
  action: DoseLogAction;
  channel: ActionChannel;
  actorUserId: string | null;
  reason: string | null;
  at: Date;
}

export type EscalationLevel = 'PRIMARY' | 'SECONDARY';

export interface EscalationRecord {
  doseEventId: string;
  level: EscalationLevel;
  notifiedUserId: string | null;
  /** dose, level and caregiver: one alert each, even after a restart. */
  idempotencyKey: string;
  sentAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedVia: ActionChannel | null;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  expoToken: string;
  platform: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface InviteRecord {
  id: string;
  profileId: string;
  invitedBy: string | null;
  /** A's keyed hash of the normalised number. The number itself is never stored. */
  phoneKey: string;
  role: LinkRole;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
}

export interface DosePatch {
  status: DoseStatus;
  stage?: DoseStage;
  snoozedUntil?: Date | null;
  actedAt?: Date | null;
}

export interface DomainStore {
  circles: {
    findByOwner(userId: string): Promise<CircleRecord | null>;
    findById(id: string): Promise<CircleRecord | null>;
    /** Creates the circle and the owner's own profile, with an ADMIN link, in one go. */
    createWithSelf(input: {
      circle: CircleRecord;
      self: ProfileRecord;
      link: LinkRecord;
    }): Promise<void>;
  };
  profiles: {
    findById(id: string): Promise<ProfileRecord | null>;
    /** Profiles the user has a link to, with their role on each, oldest first. */
    listForUser(userId: string): Promise<Array<{ profile: ProfileRecord; role: LinkRole }>>;
    countInCircle(circleId: string): Promise<number>;
    create(profile: ProfileRecord, link: LinkRecord): Promise<void>;
    update(
      id: string,
      patch: Partial<
        Pick<
          ProfileRecord,
          'name' | 'relationship' | 'age' | 'allergies' | 'mealTimes' | 'quietHours'
        >
      >,
    ): Promise<ProfileRecord | null>;
    roleOf(userId: string, profileId: string): Promise<LinkRole | null>;
    /** Profiles whose own phone has this subscriber id (Family Link). */
    findBySubscriberId(subscriberId: string): Promise<ProfileRecord[]>;
    /** Links another user to a profile (an accepted invite, or a caregiver added by the admin). */
    addLink(link: LinkRecord): Promise<void>;
    /** Everyone linked to the profile, oldest link first. */
    linksOf(profileId: string): Promise<LinkRecord[]>;
  };
  links: {
    findById(id: string): Promise<LinkRecord | null>;
    setRole(id: string, role: LinkRole): Promise<LinkRecord | null>;
    /** Marks this link the profile's secondary caregiver and clears the flag on every other. */
    setSecondary(profileId: string, linkId: string): Promise<void>;
    remove(id: string): Promise<boolean>;
  };
  invites: {
    /** False when an open invite for that number to that profile exists already. */
    create(invite: InviteRecord): Promise<boolean>;
    /** Open, unexpired invites for this phone key, oldest first. */
    openForPhone(phoneKey: string, now: Date): Promise<InviteRecord[]>;
    openForProfile(profileId: string, now: Date): Promise<InviteRecord[]>;
    /**
     * Turns the invite into a link, atomically. False when it was accepted already, or the user
     * is linked to the profile already (the invite is then closed without a second link).
     */
    accept(inviteId: string, link: LinkRecord, at: Date): Promise<boolean>;
  };
  prescriptions: {
    findById(id: string): Promise<PrescriptionRecord | null>;
    /**
     * Saves a confirmed prescription with its items and doses in one transaction. When
     * `prescription.id` is an existing DRAFT it is confirmed in place (its old draft items are
     * replaced). Doses whose idempotency key already exists are left alone.
     */
    saveConfirmed(input: {
      prescription: PrescriptionRecord;
      items: PrescriptionItemRecord[];
      doses: DoseRecord[];
    }): Promise<void>;
  };
  doses: {
    findById(id: string): Promise<DoseView | null>;
    /** Doses for a profile due in [from, to), oldest first. */
    listForProfile(profileId: string, from: Date, to: Date): Promise<DoseView[]>;
    /** Applies the patch and appends the log row, atomically. */
    applyAction(id: string, patch: DosePatch, log: DoseLogRecord): Promise<DoseRecord | null>;
    /**
     * Doses the ladder still has to look at: stage not CLOSED and due (or snoozed until) at or
     * before `now`. Oldest first, at most `limit`.
     */
    listOpen(now: Date, limit: number): Promise<DoseRecord[]>;
    /**
     * Compare-and-set for the ladder: applies the patch only if the dose is still at `from` (stage
     * and status), so two workers can never both act on one rung. Null when it had moved on.
     */
    advance(
      id: string,
      from: Pick<DoseRecord, 'stage' | 'status'>,
      patch: DosePatch,
      log: DoseLogRecord | null,
    ): Promise<DoseRecord | null>;
  };
  devices: {
    /**
     * Registers a phone for push. A token already known moves to this user (the phone was signed
     * in to another account) and its last-seen time is refreshed.
     */
    upsert(device: DeviceRecord): Promise<void>;
    listForUser(userId: string): Promise<DeviceRecord[]>;
    /** Expo said the token is no longer registered (app removed, token rotated). */
    removeToken(expoToken: string): Promise<void>;
  };
  escalations: {
    /** Records an alert. False when one with the same idempotency key exists already. */
    record(row: Omit<EscalationRecord, 'acknowledgedAt' | 'acknowledgedVia'>): Promise<boolean>;
    forDose(doseEventId: string): Promise<EscalationRecord[]>;
    /** Acknowledges every open alert for the dose. Returns how many were open. */
    acknowledge(doseEventId: string, at: Date, via: ActionChannel): Promise<number>;
    /** Alerts sent to this user since the given time, newest first. */
    listForUser(userId: string, since: Date): Promise<EscalationRecord[]>;
  };
  /** Removes every circle the user owns (and so their profiles and doses) and their links. */
  eraseUser(userId: string): Promise<void>;
}
