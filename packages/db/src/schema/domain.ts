import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { charges, users } from './platform.js';

/**
 * Domain tables, owned by workstream B (Master Plan sections 5 and 18). drizzle-kit generates the
 * SQL from this file into packages/db/drizzle/; `pnpm --filter @uposhom/db db:generate` does both
 * steps. They run after A's Applink tables, because they reference `users`.
 *
 * Conventions, matching A's tables: text primary keys with a prefix made in code (`prf_...`),
 * enumerations as text with a CHECK, timestamps with time zone, phone numbers only as `*_enc`.
 * Workstream C's drug tables (drug_generics, drug_brands, drug_info, glossary, tips) are not here
 * yet, so `drug_brand_id` columns are plain text until C's tables land; then they get a foreign key.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const identityId = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(', ')})`);

export const CIRCLE_TIERS = ['FREE', 'PREMIUM'] as const;
export const LINK_ROLES = ['ADMIN', 'CAREGIVER', 'VIEWER'] as const;
export const PRESCRIPTION_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export const MEAL_RELATIONS = ['AC', 'PC', 'WITH_MEAL', 'NONE'] as const;
export const DOSE_SLOTS = ['MORNING', 'NOON', 'EVENING', 'NIGHT', 'BEDTIME', 'STAT'] as const;
export const DOSE_STATUSES = [
  'SCHEDULED',
  'TAKEN',
  'TAKEN_LATE',
  'SNOOZED',
  'SKIPPED',
  'MISSED',
] as const;
/** Where a dose is on the escalation ladder (Master Plan section 6). */
export const DOSE_STAGES = [
  'PENDING', // created, not due yet
  'REMINDED', // T+0 reminder sent
  'REPEATED', // T+15 repeat sent
  'CAREGIVER_ALERTED', // T+30, critical only
  'SECONDARY_ALERTED', // T+50, critical only
  'CLOSED', // no more steps: acted on, or logged missed
] as const;
export const DOSE_LOG_ACTIONS = ['TAKEN', 'TAKEN_LATE', 'SNOOZE', 'SKIP', 'MISSED'] as const;
export const ACTION_CHANNELS = ['APP', 'NOTIFICATION', 'SMS', 'CAREGIVER', 'SYSTEM'] as const;
export const ESCALATION_LEVELS = ['PRIMARY', 'SECONDARY'] as const;
export const APPOINTMENT_STATES = ['PENDING', 'REMINDED', 'DONE', 'CANCELLED'] as const;
export const REPORT_FLAGS = ['LOW', 'NORMAL', 'HIGH', 'UNKNOWN'] as const;
export const SYMPTOM_SOURCES = ['TEXT', 'VOICE', 'SMS'] as const;

// ---------------------------------------------------------------- family circle

export const familyCircles = pgTable(
  'family_circles',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tier: text('tier', { enum: CIRCLE_TIERS }).notNull().default('FREE'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('family_circles_owner').on(t.ownerUserId),
    check('family_circles_tier', inList('tier', CIRCLE_TIERS)),
  ],
);

export const profiles = pgTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    circleId: text('circle_id')
      .notNull()
      .references(() => familyCircles.id, { onDelete: 'cascade' }),
    /** Set when this profile is the signed-in user's own (relationship SELF). */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    relationship: text('relationship').notNull(),
    age: integer('age'),
    allergies: text('allergies'),
    // Meal anchors for the schedule engine, 'HH:mm' Asia/Dhaka.
    mealMorning: text('meal_morning').notNull().default('08:00'),
    mealNoon: text('meal_noon').notNull().default('13:30'),
    mealEvening: text('meal_evening').notNull().default('18:00'),
    mealNight: text('meal_night').notNull().default('21:00'),
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end'),
    /** The dependent's own phone, AES-GCM, when they have one. */
    phoneEnc: text('phone_enc'),
    /**
     * Exactly as Applink returned it from the Family Link OTP verify. Opaque, maybe masked. Also
     * unique against users.subscriber_id, which the API checks: one number, one holder.
     */
    subscriberId: text('subscriber_id'),
    /** Short tag ('A', 'B') in SMS replies when one number looks after several profiles. */
    smsTag: text('sms_tag'),
    createdAt: createdAt(),
  },
  (t) => [
    index('profiles_circle').on(t.circleId),
    uniqueIndex('profiles_subscriber')
      .on(t.subscriberId)
      .where(sql`subscriber_id IS NOT NULL`),
    uniqueIndex('profiles_self')
      .on(t.userId)
      .where(sql`user_id IS NOT NULL`),
    check(
      'profiles_meal_times',
      sql`meal_morning < meal_noon AND meal_noon < meal_evening AND meal_evening < meal_night`,
    ),
  ],
);

export const links = pgTable(
  'links',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text('role', { enum: LINK_ROLES }).notNull(),
    isSecondaryCaregiver: boolean('is_secondary_caregiver').notNull().default(false),
    otpVerifiedAt: timestamp('otp_verified_at', { withTimezone: true }),
    /** A's consents row recording what the person agreed to. */
    consentId: text('consent_id'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('links_user_profile').on(t.userId, t.profileId),
    index('links_profile').on(t.profileId),
    check('links_role', inList('role', LINK_ROLES)),
  ],
);

/**
 * An invitation for someone to join a profile as admin, caregiver or viewer. The number is never
 * stored: `phone_key` is A's keyed lookup hash (security/phone-crypto.ts). It becomes a `links`
 * row when that person signs in with an OTP to that number, which is their proof and consent.
 */
export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    phoneKey: text('phone_key').notNull(),
    role: text('role', { enum: LINK_ROLES }).notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('invites_open')
      .on(t.profileId, t.phoneKey)
      .where(sql`accepted_at IS NULL`),
    index('invites_phone')
      .on(t.phoneKey)
      .where(sql`accepted_at IS NULL`),
    check('invites_role', inList('role', LINK_ROLES)),
  ],
);

export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoToken: text('expo_token').notNull().unique(),
    platform: text('platform').notNull().default('android'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_tokens_user').on(t.userId)],
);

// ---------------------------------------------------------------- prescriptions and doses

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    status: text('status', { enum: PRESCRIPTION_STATUSES }).notNull().default('DRAFT'),
    /** R2 object key of the photo. Never a public URL. */
    imagePath: text('image_path'),
    transcribedText: text('transcribed_text'),
    startDate: date('start_date'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    confirmedBy: text('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('prescriptions_profile').on(t.profileId, t.createdAt),
    check('prescriptions_status', inList('status', PRESCRIPTION_STATUSES)),
    check('prescriptions_confirmed', sql`status <> 'CONFIRMED' OR confirmed_at IS NOT NULL`),
  ],
);

export const prescriptionItems = pgTable(
  'prescription_items',
  {
    id: text('id').primaryKey(),
    prescriptionId: text('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    rawName: text('raw_name'),
    brandName: text('brand_name').notNull(),
    drugBrandId: text('drug_brand_id'),
    strength: text('strength'),
    form: text('form'),
    rawPattern: text('raw_pattern'),
    /** The pattern a person confirmed; the engine schedules from this. */
    parsedPattern: text('parsed_pattern').notNull(),
    mealRelation: text('meal_relation', { enum: MEAL_RELATIONS }).notNull().default('NONE'),
    durationDays: integer('duration_days'),
    pillCount: numeric('pill_count', { precision: 7, scale: 2 }),
    asNeeded: boolean('as_needed').notNull().default(false),
    /** Set by a person on the confirm screen, never by the model. */
    isCritical: boolean('is_critical').notNull().default(false),
    /** Per-field model confidence, 0 to 1, kept for the record. */
    confidence: jsonb('confidence'),
    courseEndsOn: date('course_ends_on'),
    refillDueOn: date('refill_due_on'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('prescription_items_position').on(t.prescriptionId, t.position),
    check('prescription_items_meal', inList('meal_relation', MEAL_RELATIONS)),
    check('prescription_items_duration', sql`duration_days IS NULL OR duration_days > 0`),
  ],
);

export const doseEvents = pgTable(
  'dose_events',
  {
    id: text('id').primaryKey(),
    /** Denormalised from the item, so timelines and the worker need no joins. */
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    prescriptionItemId: text('prescription_item_id')
      .notNull()
      .references(() => prescriptionItems.id, { onDelete: 'cascade' }),
    /** The engine's key (item, course day, slot). Re-confirming can never duplicate a dose. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    courseDate: date('course_date').notNull(),
    slot: text('slot', { enum: DOSE_SLOTS }).notNull(),
    quantity: numeric('quantity', { precision: 5, scale: 2 }).notNull(),
    mealRelation: text('meal_relation', { enum: MEAL_RELATIONS }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    isCritical: boolean('is_critical').notNull(),
    status: text('status', { enum: DOSE_STATUSES }).notNull().default('SCHEDULED'),
    stage: text('stage', { enum: DOSE_STAGES }).notNull().default('PENDING'),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('dose_events_profile_due').on(t.profileId, t.dueAt),
    index('dose_events_open')
      .on(t.stage, t.dueAt)
      .where(sql`stage <> 'CLOSED'`),
    index('dose_events_item').on(t.prescriptionItemId),
    check('dose_events_slot', inList('slot', DOSE_SLOTS)),
    check('dose_events_meal', inList('meal_relation', MEAL_RELATIONS)),
    check('dose_events_status', inList('status', DOSE_STATUSES)),
    check('dose_events_stage', inList('stage', DOSE_STAGES)),
    check('dose_events_quantity', sql`quantity > 0`),
  ],
);

export const doseLogs = pgTable(
  'dose_logs',
  {
    id: identityId(),
    doseEventId: text('dose_event_id')
      .notNull()
      .references(() => doseEvents.id, { onDelete: 'cascade' }),
    action: text('action', { enum: DOSE_LOG_ACTIONS }).notNull(),
    channel: text('channel', { enum: ACTION_CHANNELS }).notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dose_logs_event').on(t.doseEventId, t.at),
    check('dose_logs_action', inList('action', DOSE_LOG_ACTIONS)),
    check('dose_logs_channel', inList('channel', ACTION_CHANNELS)),
  ],
);

export const escalations = pgTable(
  'escalations',
  {
    id: identityId(),
    doseEventId: text('dose_event_id')
      .notNull()
      .references(() => doseEvents.id, { onDelete: 'cascade' }),
    level: text('level', { enum: ESCALATION_LEVELS }).notNull(),
    notifiedUserId: text('notified_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** One alert per dose, level and caregiver, even after a worker restart. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedVia: text('acknowledged_via', { enum: ACTION_CHANNELS }),
  },
  (t) => [
    index('escalations_dose').on(t.doseEventId),
    index('escalations_unacked')
      .on(t.notifiedUserId, t.sentAt)
      .where(sql`acknowledged_at IS NULL`),
    check('escalations_level', inList('level', ESCALATION_LEVELS)),
  ],
);

export const appointments = pgTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    reminderState: text('reminder_state', { enum: APPOINTMENT_STATES })
      .notNull()
      .default('PENDING'),
    createdAt: createdAt(),
  },
  (t) => [
    index('appointments_due').on(t.reminderState, t.dueAt),
    check('appointments_state', inList('reminder_state', APPOINTMENT_STATES)),
  ],
);

// ---------------------------------------------------------------- reports, symptoms, summaries

export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    title: text('title'),
    reportDate: date('report_date'),
    imagePath: text('image_path'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('reports_profile').on(t.profileId, t.createdAt)],
);

export const reportValues = pgTable(
  'report_values',
  {
    id: identityId(),
    reportId: text('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    testName: text('test_name').notNull(),
    value: text('value').notNull(),
    unit: text('unit'),
    /** The range printed on the report, as printed. */
    printedRange: text('printed_range'),
    flag: text('flag', { enum: REPORT_FLAGS }).notNull().default('UNKNOWN'),
  },
  (t) => [
    index('report_values_report').on(t.reportId),
    check('report_values_flag', inList('flag', REPORT_FLAGS)),
  ],
);

export const symptomLogs = pgTable(
  'symptom_logs',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    source: text('source', { enum: SYMPTOM_SOURCES }).notNull(),
    data: jsonb('data').notNull(),
    redFlag: boolean('red_flag').notNull().default(false),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('symptom_logs_profile').on(t.profileId, t.loggedAt),
    check('symptom_logs_source', inList('source', SYMPTOM_SOURCES)),
  ],
);

export const doctorSummaries = pgTable(
  'doctor_summaries',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    objectPath: text('object_path').notNull(),
    /** The settled charge that paid for it, when it was pay-per-use. */
    chargeId: text('charge_id').references(() => charges.externalTrxId, { onDelete: 'set null' }),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('doctor_summaries_profile').on(t.profileId, t.generatedAt),
    check('doctor_summaries_period', sql`period_start <= period_end`),
  ],
);

// ---------------------------------------------------------------- pharmacies

export const pharmacies = pgTable(
  'pharmacies',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    nameBn: text('name_bn'),
    address: text('address'),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    phoneEnc: text('phone_enc'),
    isPartner: boolean('is_partner').notNull().default(false),
    priorityListing: boolean('priority_listing').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pharmacies_owner')
      .on(t.ownerUserId)
      .where(sql`owner_user_id IS NOT NULL`),
    check('pharmacies_coords', sql`lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180`),
  ],
);

export const pharmacyStock = pgTable(
  'pharmacy_stock',
  {
    pharmacyId: text('pharmacy_id')
      .notNull()
      .references(() => pharmacies.id, { onDelete: 'cascade' }),
    drugBrandId: text('drug_brand_id').notNull(),
    inStock: boolean('in_stock').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.pharmacyId, t.drugBrandId] }),
    index('pharmacy_stock_drug')
      .on(t.drugBrandId)
      .where(sql`in_stock`),
  ],
);

// ---------------------------------------------------------------- traces and audit

export const agentTraces = pgTable(
  'agent_traces',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    profileId: text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    /** Where the conversation came in: APP, SMS or VOICE. */
    channel: text('channel').notNull(),
    rootAgent: text('root_agent').notNull(),
    /** Steps, handoffs and tool calls as workstream C's trace logger writes them. */
    steps: jsonb('steps').notNull(),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('agent_traces_created').on(t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: identityId(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** The profile whose record was touched, for "who looked at my records". */
    profileId: text('profile_id').references(() => profiles.id, { onDelete: 'set null' }),
    detail: jsonb('detail'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_profile').on(t.profileId, t.at),
    index('audit_log_actor').on(t.actorUserId, t.at),
  ],
);

export const NOTICE_TYPES = ['REFILL_DUE', 'FOLLOW_UP', 'WEEKLY_DIGEST'] as const;

/**
 * Inbox items that are not missed-dose alerts (those are `escalations`): refill due, a follow-up
 * appointment tomorrow, the weekly digest. One row per recipient; `ref` makes each one once-only.
 */
export const notices = pgTable(
  'notices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: text('type', { enum: NOTICE_TYPES }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** What it is about and for whom, e.g. `refill:<item>:<user>`. A second insert is a no-op. */
    ref: text('ref').notNull().unique(),
    createdAt: createdAt(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => [
    index('notices_user').on(t.userId, t.createdAt),
    check('notices_type', inList('type', NOTICE_TYPES)),
  ],
);
