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

export type ReportFlag = 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN';

export interface ReportRecord {
  id: string;
  profileId: string;
  title: string | null;
  /** YYYY-MM-DD when the printed date could be read. */
  reportDate: string | null;
  center: string | null;
  testType: string | null;
  createdBy: string | null;
  createdAt: Date;
}

export interface ReportValueRecord {
  testName: string;
  value: string;
  unit: string | null;
  printedRange: string | null;
  flag: ReportFlag;
  explanationBn: string | null;
}

export interface SymptomLogRecord {
  id: string;
  profileId: string;
  source: 'TEXT' | 'VOICE' | 'SMS';
  /** The journal's collected answers and, when finished, its summary. */
  data: Record<string, unknown>;
  redFlag: boolean;
  loggedAt: Date;
}

export interface PharmacyRecord {
  id: string;
  ownerUserId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  openingHours: string | null;
  isPartner: boolean;
  priorityListing: boolean;
  createdAt: Date;
}

export interface StockRecord {
  pharmacyId: string;
  drugBrandId: string;
  inStock: boolean;
  updatedAt: Date;
}

export interface SettingsRecord {
  userId: string;
  discreetSms: boolean;
  smsReminders: boolean;
  updatedAt: Date;
}

export type NoticeType = 'REFILL_DUE' | 'FOLLOW_UP' | 'WEEKLY_DIGEST';

export interface NoticeRecord {
  id: string;
  userId: string;
  profileId: string;
  type: NoticeType;
  title: string;
  body: string;
  /** Once-only key, e.g. `refill:<item>:<user>`. */
  ref: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

export interface TraceRecord {
  id: string;
  userId: string | null;
  profileId: string | null;
  /** APP, SMS or VOICE. */
  channel: string;
  rootAgent: string;
  /** Kept short and free of personal data by the writer. */
  inputPreview: string | null;
  handoffs: Array<{ from: string; to: string }>;
  toolCalls: Array<{ name: string; durationMs: number }>;
  durationMs: number;
  createdAt: Date;
}

export interface AuditRecord {
  actorUserId: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  profileId: string | null;
  detail: Record<string, unknown> | null;
  at: Date;
}

/** A doctor summary someone has paid for (or opened on Premium): reopening it costs nothing. */
export interface DoctorSummaryRecord {
  /** The summary's id: the journal entry it was built from, or one per profile per day. */
  id: string;
  profileId: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  /** Where the PDF is stored. Empty until object storage (R2) exists: the phone renders it. */
  objectPath: string;
  chargeId: string | null;
  generatedAt: Date;
}

export type AppointmentState = 'PENDING' | 'REMINDED' | 'DONE' | 'CANCELLED';

export interface AppointmentRecord {
  id: string;
  profileId: string;
  title: string;
  dueAt: Date;
  reminderState: AppointmentState;
  createdAt: Date;
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
    /**
     * Family Link: binds the dependent's own phone to the profile (the subscriber id exactly as
     * Applink returned it, and the number encrypted), or clears it with null. False when no such
     * profile exists.
     */
    setOwnPhone(
      id: string,
      phone: { subscriberId: string; phoneEnc: string } | null,
    ): Promise<boolean>;
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
    /** Profiles with at least one dose due in [from, to). For the weekly digest. */
    profilesWithDoses(from: Date, to: Date): Promise<string[]>;
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
  notices: {
    /** False when a notice with the same ref exists already. */
    record(row: NoticeRecord): Promise<boolean>;
    /** Sent to this user since the given time, newest first. */
    listForUser(userId: string, since: Date): Promise<NoticeRecord[]>;
  };
  traces: {
    /** Written by workstream C's trace logger. */
    record(row: TraceRecord): Promise<void>;
    /** Newest first. */
    list(limit: number): Promise<TraceRecord[]>;
    /** Retention: deletes traces created before the cutoff. Returns how many went. */
    purgeBefore(cutoff: Date): Promise<number>;
  };
  audit: {
    record(row: AuditRecord): Promise<void>;
    /** Newest first; for tests and support. */
    listForActor(actorUserId: string): Promise<AuditRecord[]>;
    /** Newest first; for tests and support. */
    listForProfile(profileId: string): Promise<AuditRecord[]>;
    /** Retention: deletes entries recorded before the cutoff. Returns how many went. */
    purgeBefore(cutoff: Date): Promise<number>;
  };
  appointments: {
    create(row: AppointmentRecord): Promise<void>;
    /** Upcoming and recent ones for the profile, soonest first. */
    listForProfile(profileId: string, from: Date): Promise<AppointmentRecord[]>;
    /** PENDING appointments due in [from, to). */
    listPendingDue(from: Date, to: Date): Promise<AppointmentRecord[]>;
    /** Compare-and-set from PENDING. False when another run got there first. */
    markReminded(id: string): Promise<boolean>;
  };
  items: {
    /** Items of the profile's CONFIRMED prescriptions confirmed since then, newest first. */
    confirmedForProfile(
      profileId: string,
      since: Date,
    ): Promise<Array<{ item: PrescriptionItemRecord; confirmedAt: Date }>>;
    /** Items of CONFIRMED prescriptions whose refill date falls in [fromDate, toDate] (YYYY-MM-DD). */
    refillDueBetween(
      fromDate: string,
      toDate: string,
    ): Promise<Array<{ item: PrescriptionItemRecord; profileId: string }>>;
  };
  reports: {
    create(report: ReportRecord, values: ReportValueRecord[]): Promise<void>;
    findById(id: string): Promise<{ report: ReportRecord; values: ReportValueRecord[] } | null>;
    /** Newest first. */
    listForProfiles(profileIds: string[]): Promise<ReportRecord[]>;
  };
  symptoms: {
    record(log: SymptomLogRecord): Promise<void>;
    findById(id: string): Promise<SymptomLogRecord | null>;
    /** Newest first, at most `limit`. */
    listForProfile(profileId: string, limit: number): Promise<SymptomLogRecord[]>;
  };
  pharmacies: {
    findByOwner(userId: string): Promise<PharmacyRecord | null>;
    /** Insert, or replace the row with the same id. */
    save(pharmacy: PharmacyRecord): Promise<void>;
    list(): Promise<PharmacyRecord[]>;
    setStock(row: StockRecord): Promise<void>;
    stockOf(pharmacyId: string): Promise<StockRecord[]>;
    stockForDrug(drugBrandId: string): Promise<StockRecord[]>;
  };
  settings: {
    get(userId: string): Promise<SettingsRecord | null>;
    put(row: SettingsRecord): Promise<void>;
  };
  summaries: {
    findById(id: string): Promise<DoctorSummaryRecord | null>;
    /** False when a row with that id exists already (nothing is changed). */
    record(row: DoctorSummaryRecord): Promise<boolean>;
  };
  /** Removes every circle the user owns (and so their profiles and doses) and their links. */
  eraseUser(userId: string): Promise<void>;
}
