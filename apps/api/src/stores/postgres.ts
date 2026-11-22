import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PhoneCrypto } from '../security/phone-crypto.js';
import type {
  ChargeRecord,
  ConsentRecord,
  DeliveryStatus,
  OtpSessionRecord,
  SessionRecord,
  SmsLogRecord,
  Stores,
  SubscriptionRecord,
  UserRecord,
} from './types.js';

type Row = Record<string, unknown>;

/** Runs `fn` in a transaction on one connection. */
async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const date = (v: unknown): Date | null => (v instanceof Date ? v : null);

/**
 * Postgres implementations of every store port. Behaviour is held to the same contract suite as
 * the in-memory stores (test/stores-contract.ts), so the two are interchangeable.
 */
export function createPostgresStores(pool: Pool, phone: PhoneCrypto): Stores {
  const user = (r: Row): UserRecord => ({
    id: r['id'] as string,
    msisdn: phone.decrypt(r['phone_enc'] as string),
    accountType: r['account_type'] as UserRecord['accountType'],
    isAdmin: r['is_admin'] as boolean,
    subscriberId: (r['subscriber_id'] as string | null) ?? null,
    applinkSubscriptionStatus: (r['applink_subscription_status'] as string | null) ?? null,
    createdAt: r['created_at'] as Date,
  });

  const otp = (r: Row): OtpSessionRecord => ({
    id: r['id'] as string,
    msisdn: phone.decrypt(r['phone_enc'] as string),
    purpose: r['purpose'] as OtpSessionRecord['purpose'],
    referenceNo: r['reference_no'] as string,
    attempts: r['attempts'] as number,
    expiresAt: r['expires_at'] as Date,
    consumedAt: date(r['consumed_at']),
    createdAt: r['created_at'] as Date,
  });

  const sms = (r: Row): SmsLogRecord => ({
    id: r['id'] as string,
    idempotencyKey: r['idempotency_key'] as string,
    subscriberId: r['subscriber_id'] as string,
    purpose: r['purpose'] as string,
    critical: r['critical'] as boolean,
    status: r['status'] as SmsLogRecord['status'],
    requestId: (r['request_id'] as string | null) ?? null,
    applinkStatusCode: (r['applink_status_code'] as string | null) ?? null,
    deliveryStatus: (r['delivery_status'] as DeliveryStatus | null) ?? null,
    createdAt: r['created_at'] as Date,
    updatedAt: r['updated_at'] as Date,
  });

  const sub = (r: Row): SubscriptionRecord => ({
    subscriberId: r['subscriber_id'] as string,
    userId: (r['user_id'] as string | null) ?? null,
    status: r['status'] as string,
    frequency: (r['frequency'] as string | null) ?? null,
    plan: (r['plan'] as SubscriptionRecord['plan']) ?? null,
    registerRequestedAt: date(r['register_requested_at']),
    lastConfirmedAt: date(r['last_confirmed_at']),
    confirmedBy: (r['confirmed_by'] as SubscriptionRecord['confirmedBy']) ?? null,
    updatedAt: r['updated_at'] as Date,
  });

  const charge = (r: Row): ChargeRecord => ({
    externalTrxId: r['external_trx_id'] as string,
    userId: r['user_id'] as string,
    subscriberId: r['subscriber_id'] as string,
    purpose: r['purpose'] as string,
    amount: r['amount'] as string,
    currency: r['currency'] as string,
    status: r['status'] as ChargeRecord['status'],
    requestCorrelator: (r['request_correlator'] as string | null) ?? null,
    internalTrxId: (r['internal_trx_id'] as string | null) ?? null,
    referenceId: (r['reference_id'] as string | null) ?? null,
    paidAmount: (r['paid_amount'] as string | null) ?? null,
    balanceDue: (r['balance_due'] as string | null) ?? null,
    otpAttempts: r['otp_attempts'] as number,
    fulfilledAt: date(r['fulfilled_at']),
    createdAt: r['created_at'] as Date,
    updatedAt: r['updated_at'] as Date,
  });

  /** Builds `col = $n` pairs for the fields a patch actually sets. */
  const setClause = (
    patch: Record<string, unknown>,
    columns: Record<string, string>,
    startAt: number,
  ): { sql: string; values: unknown[] } => {
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const [key, col] of Object.entries(columns)) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        parts.push(`${col} = $${startAt + values.length - 1}`);
      }
    }
    return { sql: parts.join(', '), values };
  };

  return {
    users: {
      async findById(id) {
        const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return rows[0] ? user(rows[0]) : null;
      },
      async findByMsisdn(msisdn) {
        const { rows } = await pool.query('SELECT * FROM users WHERE msisdn_hash = $1', [
          phone.lookupHash(msisdn),
        ]);
        return rows[0] ? user(rows[0]) : null;
      },
      async findBySubscriberId(subscriberId) {
        const { rows } = await pool.query('SELECT * FROM users WHERE subscriber_id = $1', [
          subscriberId,
        ]);
        return rows[0] ? user(rows[0]) : null;
      },
      async upsertVerified(input) {
        const id = `usr_${randomBytes(6).toString('hex')}`;
        const { rows } = await pool.query(
          `INSERT INTO users (id, msisdn_hash, phone_enc, account_type, subscriber_id, applink_subscription_status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (msisdn_hash) DO UPDATE SET
             subscriber_id = COALESCE(EXCLUDED.subscriber_id, users.subscriber_id),
             applink_subscription_status =
               COALESCE(EXCLUDED.applink_subscription_status, users.applink_subscription_status)
           RETURNING *`,
          [
            id,
            phone.lookupHash(input.msisdn),
            phone.encrypt(input.msisdn),
            input.accountType,
            input.subscriberId,
            input.subscriptionStatus,
          ],
        );
        return user(rows[0] as Row);
      },
    },

    otpSessions: {
      async create(input) {
        return tx(pool, async (c) => {
          const hash = phone.lookupHash(input.msisdn);
          await c.query(
            'UPDATE otp_sessions SET consumed_at = now() WHERE msisdn_hash = $1 AND consumed_at IS NULL',
            [hash],
          );
          const { rows } = await c.query(
            `INSERT INTO otp_sessions (id, msisdn_hash, phone_enc, purpose, reference_no, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [
              randomUUID(),
              hash,
              phone.encrypt(input.msisdn),
              input.purpose,
              input.referenceNo,
              input.expiresAt,
            ],
          );
          return otp(rows[0] as Row);
        });
      },
      async findOpen(msisdn, now) {
        const { rows } = await pool.query(
          `SELECT * FROM otp_sessions
           WHERE msisdn_hash = $1 AND consumed_at IS NULL AND expires_at > $2
           ORDER BY created_at DESC LIMIT 1`,
          [phone.lookupHash(msisdn), now],
        );
        return rows[0] ? otp(rows[0]) : null;
      },
      async incrementAttempts(id) {
        const { rows } = await pool.query(
          'UPDATE otp_sessions SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts',
          [id],
        );
        return (rows[0]?.['attempts'] as number | undefined) ?? Number.MAX_SAFE_INTEGER;
      },
      async consume(id, now) {
        await pool.query('UPDATE otp_sessions SET consumed_at = $2 WHERE id = $1', [id, now]);
      },
    },

    consents: {
      async record(input, now) {
        const { rows } = await pool.query(
          `INSERT INTO consents
             (id, user_id, msisdn_hash, kind, channel, ip, wording, amount, currency, frequency, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [
            randomUUID(),
            input.userId ?? null,
            input.msisdn ? phone.lookupHash(input.msisdn) : null,
            input.kind,
            input.channel,
            input.ip,
            input.wording ?? null,
            input.amount ?? null,
            input.currency ?? null,
            input.frequency ?? null,
            now,
          ],
        );
        const r = rows[0] as Row;
        const out: ConsentRecord = {
          id: r['id'] as string,
          userId: (r['user_id'] as string | null) ?? null,
          msisdn: input.msisdn ?? null,
          kind: r['kind'] as string,
          channel: r['channel'] as ConsentRecord['channel'],
          ip: (r['ip'] as string | null) ?? null,
          wording: (r['wording'] as string | null) ?? null,
          amount: (r['amount'] as string | null) ?? null,
          currency: (r['currency'] as string | null) ?? null,
          frequency: (r['frequency'] as string | null) ?? null,
          createdAt: r['created_at'] as Date,
        };
        return out;
      },
      async hasKind(userId, kind) {
        const { rowCount } = await pool.query(
          'SELECT 1 FROM consents WHERE user_id = $1 AND kind = $2 LIMIT 1',
          [userId, kind],
        );
        return (rowCount ?? 0) > 0;
      },
    },

    sessions: {
      async create(input) {
        const { rows } = await pool.query(
          `INSERT INTO sessions (id, user_id, refresh_hash, expires_at)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [randomUUID(), input.userId, input.refreshHash, input.expiresAt],
        );
        return session(rows[0] as Row);
      },
      async findByRefreshHash(hash) {
        const { rows } = await pool.query('SELECT * FROM sessions WHERE refresh_hash = $1', [hash]);
        return rows[0] ? session(rows[0]) : null;
      },
      async rotate(id, oldHash, newHash, expiresAt) {
        // One statement, so two refreshes with the same token cannot both win.
        const { rowCount } = await pool.query(
          `UPDATE sessions SET refresh_hash = $3, expires_at = $4
           WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL`,
          [id, oldHash, newHash, expiresAt],
        );
        return (rowCount ?? 0) > 0;
      },
      async revoke(id, now) {
        await pool.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1', [id, now]);
      },
    },

    dedupe: {
      async firstSeen(key, now) {
        const { rowCount } = await pool.query(
          'INSERT INTO callback_dedupe (key, seen_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
          [key, now],
        );
        return (rowCount ?? 0) > 0;
      },
    },

    smsLog: {
      async create(input, now) {
        const ins = await pool.query(
          `INSERT INTO sms_log
             (id, idempotency_key, subscriber_id, purpose, critical, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $6)
           ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
          [
            randomUUID(),
            input.idempotencyKey,
            input.subscriberId,
            input.purpose,
            input.critical,
            now,
          ],
        );
        if (ins.rows[0]) return { record: sms(ins.rows[0]), created: true };
        const { rows } = await pool.query('SELECT * FROM sms_log WHERE idempotency_key = $1', [
          input.idempotencyKey,
        ]);
        return { record: sms(rows[0] as Row), created: false };
      },
      async findByIdempotencyKey(key) {
        const { rows } = await pool.query('SELECT * FROM sms_log WHERE idempotency_key = $1', [
          key,
        ]);
        return rows[0] ? sms(rows[0]) : null;
      },
      async findByRequestId(requestId) {
        const { rows } = await pool.query(
          'SELECT * FROM sms_log WHERE request_id = $1 ORDER BY created_at DESC LIMIT 1',
          [requestId],
        );
        return rows[0] ? sms(rows[0]) : null;
      },
      async update(id, patch, now) {
        const set = setClause(
          patch,
          {
            status: 'status',
            requestId: 'request_id',
            applinkStatusCode: 'applink_status_code',
            deliveryStatus: 'delivery_status',
          },
          3,
        );
        const { rows } = await pool.query(
          `UPDATE sms_log SET ${set.sql ? set.sql + ', ' : ''}updated_at = $2 WHERE id = $1 RETURNING *`,
          [id, now, ...set.values],
        );
        return rows[0] ? sms(rows[0]) : null;
      },
      async recentForSubscriber(subscriberId, limit) {
        const { rows } = await pool.query(
          'SELECT * FROM sms_log WHERE subscriber_id = $1 ORDER BY created_at DESC LIMIT $2',
          [subscriberId, limit],
        );
        return rows.map(sms);
      },
    },

    subscriptions: {
      async get(subscriberId) {
        const { rows } = await pool.query(
          'SELECT * FROM subscriptions_mirror WHERE subscriber_id = $1',
          [subscriberId],
        );
        return rows[0] ? sub(rows[0]) : null;
      },
      async findByUserId(userId) {
        const { rows } = await pool.query(
          'SELECT * FROM subscriptions_mirror WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
          [userId],
        );
        return rows[0] ? sub(rows[0]) : null;
      },
      async upsert(patch, now) {
        // Insert with defaults, then merge only the fields the caller set.
        await pool.query(
          `INSERT INTO subscriptions_mirror (subscriber_id, status, updated_at)
           VALUES ($1, 'INITIAL', $2) ON CONFLICT (subscriber_id) DO NOTHING`,
          [patch.subscriberId, now],
        );
        const set = setClause(
          {
            userId: patch.userId,
            status: patch.status,
            frequency: patch.frequency,
            plan: patch.plan,
            registerRequestedAt: patch.registerRequestedAt,
            lastConfirmedAt: patch.confirmedAt,
            confirmedBy: patch.confirmedBy,
          },
          {
            userId: 'user_id',
            status: 'status',
            frequency: 'frequency',
            plan: 'plan',
            registerRequestedAt: 'register_requested_at',
            lastConfirmedAt: 'last_confirmed_at',
            confirmedBy: 'confirmed_by',
          },
          3,
        );
        const { rows } = await pool.query(
          `UPDATE subscriptions_mirror SET ${set.sql ? set.sql + ', ' : ''}updated_at = $2
           WHERE subscriber_id = $1 RETURNING *`,
          [patch.subscriberId, now, ...set.values],
        );
        return sub(rows[0] as Row);
      },
      async listStale(before, limit) {
        const { rows } = await pool.query(
          `SELECT * FROM subscriptions_mirror
           WHERE last_confirmed_at IS NULL OR last_confirmed_at < $1
           ORDER BY last_confirmed_at NULLS FIRST LIMIT $2`,
          [before, limit],
        );
        return rows.map(sub);
      },
    },

    charges: {
      async create(input, now) {
        const { rows } = await pool.query(
          `INSERT INTO charges
             (external_trx_id, user_id, subscriber_id, purpose, amount, currency, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $7) RETURNING *`,
          [
            input.externalTrxId,
            input.userId,
            input.subscriberId,
            input.purpose,
            input.amount,
            input.currency,
            now,
          ],
        );
        return charge(rows[0] as Row);
      },
      async get(externalTrxId) {
        const { rows } = await pool.query('SELECT * FROM charges WHERE external_trx_id = $1', [
          externalTrxId,
        ]);
        return rows[0] ? charge(rows[0]) : null;
      },
      async update(externalTrxId, patch, now) {
        const set = setClause(
          patch,
          {
            status: 'status',
            requestCorrelator: 'request_correlator',
            internalTrxId: 'internal_trx_id',
            referenceId: 'reference_id',
            paidAmount: 'paid_amount',
            balanceDue: 'balance_due',
            fulfilledAt: 'fulfilled_at',
          },
          3,
        );
        const { rows } = await pool.query(
          `UPDATE charges SET ${set.sql ? set.sql + ', ' : ''}updated_at = $2
           WHERE external_trx_id = $1 RETURNING *`,
          [externalTrxId, now, ...set.values],
        );
        return rows[0] ? charge(rows[0]) : null;
      },
      async incrementOtpAttempts(externalTrxId) {
        const { rows } = await pool.query(
          'UPDATE charges SET otp_attempts = otp_attempts + 1 WHERE external_trx_id = $1 RETURNING otp_attempts',
          [externalTrxId],
        );
        return (rows[0]?.['otp_attempts'] as number | undefined) ?? Number.MAX_SAFE_INTEGER;
      },
      async listOpen(olderThan, limit) {
        const { rows } = await pool.query(
          `SELECT * FROM charges
           WHERE status IN ('PENDING', 'OTP_SENT', 'PROCESSING') AND updated_at < $1
           ORDER BY updated_at LIMIT $2`,
          [olderThan, limit],
        );
        return rows.map(charge);
      },
    },

    entitlements: {
      async grant(input, now) {
        // granted_by_charge is UNIQUE: the second insert for the same charge does nothing.
        const { rowCount } = await pool.query(
          `INSERT INTO entitlements (id, user_id, feature, quantity, granted_by_charge, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (granted_by_charge) DO NOTHING`,
          [randomUUID(), input.userId, input.feature, input.quantity, input.chargeId, now],
        );
        return { granted: (rowCount ?? 0) > 0 };
      },
      async available(userId, feature) {
        const { rows } = await pool.query(
          `SELECT COALESCE(SUM(quantity - consumed), 0)::int AS n
           FROM entitlements WHERE user_id = $1 AND feature = $2`,
          [userId, feature],
        );
        return (rows[0]?.['n'] as number | undefined) ?? 0;
      },
      async consume(userId, feature) {
        // Atomic: the UPDATE picks one row with a credit left and spends it in one statement.
        const { rowCount } = await pool.query(
          `UPDATE entitlements SET consumed = consumed + 1
           WHERE id = (
             SELECT id FROM entitlements
             WHERE user_id = $1 AND feature = $2 AND consumed < quantity
             ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
           )`,
          [userId, feature],
        );
        return (rowCount ?? 0) > 0;
      },
    },

    usage: {
      async get(userId, counter, period) {
        const { rows } = await pool.query(
          'SELECT used FROM usage_counters WHERE user_id = $1 AND counter = $2 AND period = $3',
          [userId, counter, period],
        );
        return (rows[0]?.['used'] as number | undefined) ?? 0;
      },
      async increment(userId, counter, period, by = 1) {
        const { rows } = await pool.query(
          `INSERT INTO usage_counters (user_id, counter, period, used) VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, counter, period) DO UPDATE SET used = usage_counters.used + $4
           RETURNING used`,
          [userId, counter, period, by],
        );
        return rows[0]?.['used'] as number;
      },
      async incrementIfBelow(userId, counter, period, limit) {
        // One statement: the insert path only runs for a limit above zero, and the conflict path
        // only bumps the row while it is still below the limit. No row back means "refused".
        const { rows } = await pool.query(
          `INSERT INTO usage_counters (user_id, counter, period, used)
           SELECT $1, $2, $3, 1 WHERE $4::int > 0
           ON CONFLICT (user_id, counter, period)
             DO UPDATE SET used = usage_counters.used + 1 WHERE usage_counters.used < $4::int
           RETURNING used`,
          [userId, counter, period, limit],
        );
        return (rows[0]?.['used'] as number | undefined) ?? null;
      },
    },

    optOuts: {
      async suppress(input, now) {
        // STOP outranks the other reasons: a withdrawn consent is never downgraded.
        await pool.query(
          `INSERT INTO sms_opt_outs (subscriber_id, reason, source, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (subscriber_id) DO UPDATE
             SET reason = EXCLUDED.reason, source = EXCLUDED.source
             WHERE sms_opt_outs.reason <> 'STOP'`,
          [input.subscriberId, input.reason, input.source, now],
        );
      },
      async suppressionFor(subscriberId) {
        const { rows } = await pool.query(
          'SELECT reason FROM sms_opt_outs WHERE subscriber_id = $1',
          [subscriberId],
        );
        return (rows[0]?.['reason'] as 'STOP' | 'DEAD_NUMBER' | 'BLOCKED' | undefined) ?? null;
      },
      async clearStop(subscriberId) {
        await pool.query("DELETE FROM sms_opt_outs WHERE subscriber_id = $1 AND reason = 'STOP'", [
          subscriberId,
        ]);
      },
    },

    rateLimit: {
      async hit(key, limit, windowMs, now) {
        return tx(pool, async (c) => {
          // Serialise hits on one key so two requests cannot both squeeze under the limit.
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
          const since = new Date(now.getTime() - windowMs);
          await c.query('DELETE FROM rate_limit_hits WHERE key = $1 AND at <= $2', [key, since]);
          const { rows } = await c.query(
            'SELECT at FROM rate_limit_hits WHERE key = $1 ORDER BY at',
            [key],
          );
          if (rows.length >= limit) {
            const oldest = (rows[0]?.['at'] as Date).getTime();
            return {
              allowed: false,
              retryAfterSeconds: Math.ceil((oldest + windowMs - now.getTime()) / 1000),
            };
          }
          await c.query('INSERT INTO rate_limit_hits (key, at) VALUES ($1, $2)', [key, now]);
          return { allowed: true, retryAfterSeconds: 0 };
        });
      },
    },
  };

  function session(r: Row): SessionRecord {
    return {
      id: r['id'] as string,
      userId: r['user_id'] as string,
      refreshHash: r['refresh_hash'] as string,
      expiresAt: r['expires_at'] as Date,
      revokedAt: date(r['revoked_at']),
    };
  }
}
