/**
 * Schema for the Applink-side tables (Master Plan section 5): users, otp_sessions, sessions,
 * consents, sms_log, sms_opt_outs, callback_dedupe, subscriptions_mirror, charges, entitlements,
 * usage_counters, plus the small helper tables the platform needs.
 *
 * These are plain, ordered SQL migrations owned by workstream A. They live beside the API so they
 * do not depend on the Drizzle setup in packages/db (workstream B). When that lands, B can adopt
 * these files as the first migrations or translate them into Drizzle schema: the table and column
 * names are meant to survive unchanged. Never edit a migration that has shipped; add a new one.
 *
 * Phone numbers are never stored in the clear: `phone_enc` is AES-256-GCM and `msisdn_hash` is a
 * keyed hash used only for lookup (see security/phone-crypto.ts).
 */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_auth_and_sms',
    sql: `
CREATE TABLE users (
  id text PRIMARY KEY,
  msisdn_hash text NOT NULL UNIQUE,
  phone_enc text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('INDIVIDUAL', 'PHARMACY')),
  is_admin boolean NOT NULL DEFAULT false,
  -- Exactly as Applink returned it from OTP verify: opaque, possibly masked. The join key for
  -- every callback. Never put it in a token or send it to the app.
  subscriber_id text UNIQUE,
  applink_subscription_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_sessions (
  id uuid PRIMARY KEY,
  msisdn_hash text NOT NULL,
  phone_enc text NOT NULL,
  purpose text NOT NULL,
  -- From /otp/request. Server-side only: never returned to the app, never logged.
  reference_no text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_sessions_lookup ON otp_sessions (msisdn_hash, created_at DESC);
CREATE INDEX otp_sessions_expiry ON otp_sessions (expires_at);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions (user_id);

-- What was shown and accepted, when, on which channel. One row per consent, never updated.
CREATE TABLE consents (
  id uuid PRIMARY KEY,
  user_id text REFERENCES users (id) ON DELETE SET NULL,
  msisdn_hash text,
  kind text NOT NULL,
  channel text NOT NULL,
  ip text,
  wording text,
  amount text,
  currency text,
  frequency text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_kind ON consents (user_id, kind);

CREATE TABLE callback_dedupe (
  key text PRIMARY KEY,
  seen_at timestamptz NOT NULL
);
CREATE INDEX callback_dedupe_seen ON callback_dedupe (seen_at);

CREATE TABLE rate_limit_hits (
  key text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX rate_limit_hits_key_at ON rate_limit_hits (key, at);

-- No message bodies: identifiers and statuses only.
CREATE TABLE sms_log (
  id uuid PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  subscriber_id text NOT NULL,
  purpose text NOT NULL,
  critical boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  request_id text,
  applink_status_code text,
  delivery_status text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX sms_log_request ON sms_log (request_id);
CREATE INDEX sms_log_subscriber ON sms_log (subscriber_id, created_at DESC);
CREATE INDEX sms_log_created ON sms_log (created_at);

CREATE TABLE sms_opt_outs (
  subscriber_id text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('STOP', 'DEAD_NUMBER', 'BLOCKED')),
  source text NOT NULL,
  created_at timestamptz NOT NULL
);
`,
  },
  {
    id: '0002_billing',
    sql: `
-- Subscription state mirrored from the subscriber notification and our own Register calls.
-- Entitlements read only this table: no Applink call on any login or page-load path.
CREATE TABLE subscriptions_mirror (
  subscriber_id text PRIMARY KEY,
  user_id text REFERENCES users (id) ON DELETE SET NULL,
  status text NOT NULL,
  frequency text,
  plan text,
  -- Set when WE called Register for a plan. Part of the Premium gate.
  register_requested_at timestamptz,
  last_confirmed_at timestamptz,
  confirmed_by text,
  updated_at timestamptz NOT NULL
);
CREATE INDEX subscriptions_mirror_user ON subscriptions_mirror (user_id);

-- The charging ledger. The row is written BEFORE Applink is called.
CREATE TABLE charges (
  external_trx_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subscriber_id text NOT NULL,
  purpose text NOT NULL,
  amount text NOT NULL,
  currency text NOT NULL DEFAULT 'BDT',
  status text NOT NULL,
  request_correlator text,
  internal_trx_id text,
  reference_id text,
  paid_amount text,
  balance_due text,
  otp_attempts integer NOT NULL DEFAULT 0,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX charges_user ON charges (user_id, created_at DESC);
CREATE INDEX charges_open ON charges (status, updated_at);

-- Granted features. A settled charge grants its entitlement exactly once (idempotent on the
-- charge), whatever number of notifications arrive.
CREATE TABLE entitlements (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feature text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  consumed integer NOT NULL DEFAULT 0,
  granted_by_charge text UNIQUE REFERENCES charges (external_trx_id),
  created_at timestamptz NOT NULL
);
CREATE INDEX entitlements_user_feature ON entitlements (user_id, feature);

CREATE TABLE usage_counters (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  counter text NOT NULL,
  period text NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, counter, period)
);
`,
  },
  {
    id: '0003_charges_outlive_users',
    sql: `
-- Erasing an account anonymises its charges instead of deleting them: the ledger is the record
-- needed to investigate a charging dispute, and it then holds no link to a person.
ALTER TABLE charges ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE charges DROP CONSTRAINT charges_user_id_fkey;
ALTER TABLE charges ADD CONSTRAINT charges_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL;
`,
  },
];
