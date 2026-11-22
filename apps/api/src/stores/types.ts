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
  /** Insert or update by msisdn. `accountType` is only applied on insert. */
  upsertVerified(input: {
    msisdn: string;
    accountType: AccountType;
    subscriberId: string | null;
    subscriptionStatus: string | null;
  }): Promise<UserRecord>;
}

export interface OtpSessionRecord {
  id: string;
  msisdn: string;
  purpose: 'SIGNUP';
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
    purpose: 'SIGNUP';
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
  msisdn: string;
  /** What was shown and accepted, for example 'SIGNUP_OTP_V1'. */
  kind: string;
  channel: 'APP' | 'SMS' | 'USSD';
  ip: string | null;
  createdAt: Date;
}

export interface ConsentStore {
  record(input: Omit<ConsentRecord, 'id' | 'createdAt'>, now: Date): Promise<ConsentRecord>;
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

export interface Stores {
  users: UserStore;
  otpSessions: OtpSessionStore;
  consents: ConsentStore;
  sessions: SessionStore;
  dedupe: DedupeStore;
  rateLimit: RateLimitStore;
}
