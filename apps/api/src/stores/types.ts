/**
 * Persistence ports for the Applink-side tables (Master Plan section 8: users, otp_sessions,
 * consents, sessions, callback_dedupe). Day 1 ships in-memory implementations so the flows work
 * on the mock; Postgres implementations replace them when B's Drizzle migrations land. Nothing
 * outside src/stores may know which implementation is in use.
 */

export type AccountType = 'INDIVIDUAL' | 'PHARMACY';

export interface UserRecord {
  id: string;
  /** Normalised 8801XXXXXXXXX. Becomes `phone_enc` (encrypted) in Postgres. */
  msisdn: string;
  accountType: AccountType;
  isAdmin: boolean;
  /** Exactly as Applink returned it from OTP verify: opaque, possibly masked. Never client-visible. */
  subscriberId: string | null;
  applinkSubscriptionStatus: string | null;
  createdAt: Date;
}

export interface UserStore {
  findById(id: string): Promise<UserRecord | null>;
  findByMsisdn(msisdn: string): Promise<UserRecord | null>;
  /** Callbacks identify people by the opaque subscriber id, never by the typed number. */
  findBySubscriberId(subscriberId: string): Promise<UserRecord | null>;
  /**
   * Erases everything the Applink side holds about this person (right to delete): sessions,
   * consents, OTP sessions, the SMS log and subscription mirror for their subscriber id,
   * entitlements and usage counters, and the account itself. Charges are ANONYMISED, not deleted:
   * the ledger is needed to investigate a dispute and then holds no link to a person. A STOP
   * entry is kept on purpose so the number is never messaged again.
   */
  erase(userId: string): Promise<void>;
  /** Insert or update by msisdn. `accountType` is only applied on insert. */
  upsertVerified(input: {
    msisdn: string;
    accountType: AccountType;
    subscriberId: string | null;
    subscriptionStatus: string | null;
  }): Promise<UserRecord>;
}

export type OtpPurpose = 'SIGNUP' | 'STEP_UP';

export interface OtpSessionRecord {
  id: string;
  msisdn: string;
  purpose: OtpPurpose;
  /** Kept server-side only. Never logged, never returned to the app. */
  referenceNo: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface OtpSessionStore {
  /** Invalidates any earlier open session for the number, then stores this one. */
  create(input: {
    msisdn: string;
    purpose: OtpPurpose;
    referenceNo: string;
    expiresAt: Date;
  }): Promise<OtpSessionRecord>;
  /** Latest unconsumed, unexpired session for the number. */
  findOpen(msisdn: string, now: Date): Promise<OtpSessionRecord | null>;
  incrementAttempts(id: string): Promise<number>;
  consume(id: string, now: Date): Promise<void>;
}

export interface ConsentRecord {
  id: string;
  /** Set once the person has an account. Sign-up consent is recorded before that, by number. */
  userId: string | null;
  msisdn: string | null;
  /** What was shown and accepted, for example 'SIGNUP_OTP_V1' or 'FAMILY_CIRCLE_V1'. */
  kind: string;
  channel: 'APP' | 'SMS';
  ip: string | null;
  /** The exact wording shown on screen, kept as consent evidence. */
  wording: string | null;
  amount: string | null;
  currency: string | null;
  frequency: string | null;
  createdAt: Date;
}

export interface ConsentStore {
  record(
    input: {
      userId?: string;
      msisdn?: string;
      kind: string;
      channel: 'APP' | 'SMS';
      ip: string | null;
      wording?: string;
      amount?: string;
      currency?: string;
      frequency?: string;
    },
    now: Date,
  ): Promise<ConsentRecord>;
  /** True if the user has recorded this kind of consent at least once. Part of the Premium gate. */
  hasKind(userId: string, kind: string): Promise<boolean>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  refreshHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionStore {
  create(input: { userId: string; refreshHash: string; expiresAt: Date }): Promise<SessionRecord>;
  findByRefreshHash(hash: string): Promise<SessionRecord | null>;
  /** Atomically replaces the refresh hash if the session is still live. Returns false otherwise. */
  rotate(id: string, oldHash: string, newHash: string, expiresAt: Date): Promise<boolean>;
  revoke(id: string, now: Date): Promise<void>;
}

export interface DedupeStore {
  /** True the first time a key is seen, false on every redelivery. */
  firstSeen(key: string, now: Date): Promise<boolean>;
}

/** Sliding-window counter used by the OTP rate limits. */
export interface RateLimitStore {
  /** Counts a hit and reports whether the limit is exceeded. */
  hit(
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export type SmsStatus =
  | 'PENDING' // row written, Applink not (successfully) called yet: safe to retry
  | 'SUBMITTED' // Applink accepted it; delivery reports update deliveryStatus
  | 'FAILED' // rejected for this recipient, will not be retried
  | 'UNKNOWN' // transport failure after sending: it may have gone out, never re-sent blindly
  | 'SKIPPED'; // suppressed (opted out, dead or blocked number)

export type DeliveryStatus =
  'DELIVERED' | 'EXPIRED' | 'DELETED' | 'UNDELIVERABLE' | 'ACCEPTED' | 'UNKNOWN' | 'REJECTED';

import type { PurgeCounts } from '../ops/retention.js';

/** No message bodies: sms_log holds identifiers and statuses only. */
export interface SmsLogRecord {
  id: string;
  idempotencyKey: string;
  subscriberId: string;
  purpose: string;
  critical: boolean;
  status: SmsStatus;
  /** Applink's requestId, which delivery reports carry. */
  requestId: string | null;
  applinkStatusCode: string | null;
  deliveryStatus: DeliveryStatus | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsLogStore {
  /** Idempotent on idempotencyKey: an existing row is returned with created false. */
  create(
    input: Pick<SmsLogRecord, 'idempotencyKey' | 'subscriberId' | 'purpose' | 'critical'>,
    now: Date,
  ): Promise<{ record: SmsLogRecord; created: boolean }>;
  findByIdempotencyKey(key: string): Promise<SmsLogRecord | null>;
  findByRequestId(requestId: string): Promise<SmsLogRecord | null>;
  update(
    id: string,
    patch: Partial<
      Pick<SmsLogRecord, 'status' | 'requestId' | 'applinkStatusCode' | 'deliveryStatus'>
    >,
    now: Date,
  ): Promise<SmsLogRecord | null>;
  /** Most recent sends to a subscriber, newest first. */
  recentForSubscriber(subscriberId: string, limit: number): Promise<SmsLogRecord[]>;
}

export type SuppressionReason =
  | 'STOP' // the subscriber opted out (SMS, app or operator notification)
  | 'DEAD_NUMBER' // repeated UNDELIVERABLE
  | 'BLOCKED'; // Applink E1342: blacklisted, no further messages

export interface OptOutStore {
  suppress(
    input: {
      subscriberId: string;
      reason: SuppressionReason;
      source: 'SMS' | 'APP' | 'NOTIFICATION' | 'SYSTEM';
    },
    now: Date,
  ): Promise<void>;
  /** The reason a number is suppressed, or null when we may message it. */
  suppressionFor(subscriberId: string): Promise<SuppressionReason | null>;
  /**
   * Lifts a STOP after the person re-subscribes with fresh, recorded consent. Never lifts BLOCKED
   * (Applink blacklisted the number) or DEAD_NUMBER (it does not receive messages).
   */
  clearStop(subscriberId: string): Promise<void>;
}

export type SubscriptionPlan = 'FAMILY_CIRCLE' | 'PHARMACY';

export interface SubscriptionRecord {
  subscriberId: string;
  userId: string | null;
  /** As Applink reports it: REGISTERED, TRIAL, REG_PENDING, TEMPORARY_BLOCKED, UNREGISTERED, INITIAL. */
  status: string;
  frequency: string | null;
  plan: SubscriptionPlan | null;
  /** When WE called Register for the plan. Without it a REGISTERED status never unlocks Premium. */
  registerRequestedAt: Date | null;
  lastConfirmedAt: Date | null;
  confirmedBy: 'NOTIFICATION' | 'REGISTER_RESPONSE' | 'SWEEP' | null;
  updatedAt: Date;
}

export interface SubscriptionStore {
  get(subscriberId: string): Promise<SubscriptionRecord | null>;
  findByUserId(userId: string): Promise<SubscriptionRecord | null>;
  /** Merge: fields left undefined are untouched. Creates the row if it does not exist. */
  upsert(
    patch: {
      subscriberId: string;
      userId?: string | null;
      status?: string;
      frequency?: string | null;
      plan?: SubscriptionPlan | null;
      registerRequestedAt?: Date | null;
      confirmedAt?: Date | null;
      confirmedBy?: SubscriptionRecord['confirmedBy'];
    },
    now: Date,
  ): Promise<SubscriptionRecord>;
  /** Rows never confirmed, or not confirmed since `before`: the nightly sweep's work list. */
  listStale(before: Date, limit: number): Promise<SubscriptionRecord[]>;
}

export type ChargeStatus =
  | 'PENDING' // ledger row written, Applink not yet called
  | 'OTP_SENT' // step 1 returned P1003: the OTP is with the subscriber, nothing is charged
  | 'PROCESSING' // step 2 accepted: submitted, awaiting the charging notification
  | 'PARTIAL' // a partial charging notification arrived
  | 'SETTLED' // fully paid: fulfilled
  | 'FAILED'
  | 'INSUFFICIENT_BALANCE'
  | 'EXPIRED';

export interface ChargeRecord {
  externalTrxId: string;
  /** Null once the account has been erased: the charge stays as an anonymous ledger entry. */
  userId: string | null;
  subscriberId: string;
  purpose: string;
  /** Decimal BDT string such as "5.00". */
  amount: string;
  currency: string;
  status: ChargeStatus;
  requestCorrelator: string | null;
  internalTrxId: string | null;
  referenceId: string | null;
  paidAmount: string | null;
  balanceDue: string | null;
  otpAttempts: number;
  fulfilledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChargeStore {
  create(
    input: Pick<
      ChargeRecord,
      'externalTrxId' | 'subscriberId' | 'purpose' | 'amount' | 'currency'
    > & { userId: string },
    now: Date,
  ): Promise<ChargeRecord>;
  get(externalTrxId: string): Promise<ChargeRecord | null>;
  update(
    externalTrxId: string,
    patch: Partial<
      Pick<
        ChargeRecord,
        | 'status'
        | 'requestCorrelator'
        | 'internalTrxId'
        | 'referenceId'
        | 'paidAmount'
        | 'balanceDue'
        | 'fulfilledAt'
      >
    >,
    now: Date,
  ): Promise<ChargeRecord | null>;
  incrementOtpAttempts(externalTrxId: string): Promise<number>;
  /** Charges still unsettled and untouched since `olderThan`: the reconciliation work list. */
  listOpen(olderThan: Date, limit: number): Promise<ChargeRecord[]>;
}

export interface EntitlementStore {
  /** Idempotent on chargeId: a settled charge grants its entitlement exactly once. */
  grant(
    input: { userId: string; feature: string; quantity: number; chargeId: string },
    now: Date,
  ): Promise<{ granted: boolean }>;
  /** Unused credits for the feature. */
  available(userId: string, feature: string): Promise<number>;
  /** Takes one credit if there is one. Atomic: two requests cannot spend the same credit. */
  consume(userId: string, feature: string): Promise<boolean>;
}

export interface UsageStore {
  get(userId: string, counter: string, period: string): Promise<number>;
  increment(userId: string, counter: string, period: string, by?: number): Promise<number>;
  /**
   * Adds one only while the counter is below `limit`, atomically. Returns the new value, or null
   * when the limit is already reached. Two simultaneous requests cannot both take the last unit.
   */
  incrementIfBelow(
    userId: string,
    counter: string,
    period: string,
    limit: number,
  ): Promise<number | null>;
}

export interface MaintenanceStore {
  /** Deletes rows past their retention (src/ops/retention.ts). Returns how many of each. */
  purge(now: Date): Promise<PurgeCounts>;
}

export interface Stores {
  users: UserStore;
  otpSessions: OtpSessionStore;
  consents: ConsentStore;
  sessions: SessionStore;
  dedupe: DedupeStore;
  smsLog: SmsLogStore;
  subscriptions: SubscriptionStore;
  charges: ChargeStore;
  entitlements: EntitlementStore;
  usage: UsageStore;
  optOuts: OptOutStore;
  rateLimit: RateLimitStore;
  maintenance: MaintenanceStore;
}
