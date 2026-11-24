/**
 * Retention (Master Plan section 8). Enforced nightly by the retention job, so privacy promises
 * are kept by code and not by habit. Consent rows are evidence of what a person agreed to and are
 * kept until the person deletes their data; they are never purged here.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const RETENTION = {
  /** sms_log: identifiers and statuses, never bodies. */
  smsLogMs: 90 * DAY_MS,
  /** callback_dedupe: only needs to outlive Applink's redelivery window. */
  callbackDedupeMs: 30 * DAY_MS,
  /** otp_sessions: kept this long after they expire, for support, then removed. */
  otpAfterExpiryMs: 24 * HOUR_MS,
  /** rate_limit_hits: the longest window we use is one day. */
  rateLimitHitsMs: 24 * HOUR_MS,
  /** sessions: expired or revoked refresh tokens go this long after. */
  sessionAfterExpiryMs: 30 * DAY_MS,
  /** agent_traces: the admin trace screen only needs recent runs. Purged by the domain job. */
  agentTracesMs: 30 * DAY_MS,
  /** audit_log: who read or changed a medical record. Purged by the domain job. */
  auditLogMs: 365 * DAY_MS,
} as const;

export interface PurgeCounts {
  smsLog: number;
  callbackDedupe: number;
  otpSessions: number;
  rateLimitHits: number;
  sessions: number;
}
