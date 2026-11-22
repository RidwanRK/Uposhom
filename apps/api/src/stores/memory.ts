import { randomUUID } from 'node:crypto';
import type {
  ConsentRecord,
  OtpSessionRecord,
  SessionRecord,
  SmsLogRecord,
  Stores,
  SuppressionReason,
  UserRecord,
  UssdSessionRecord,
} from './types.js';

/** In-memory stores: Day 1 only. State is lost on restart, so this is not for production data. */
export function createMemoryStores(): Stores {
  const users = new Map<string, UserRecord>();
  const otpSessions = new Map<string, OtpSessionRecord>();
  const consents: ConsentRecord[] = [];
  const sessions = new Map<string, SessionRecord>();
  const seen = new Map<string, number>();
  const hits = new Map<string, number[]>();
  const smsLog = new Map<string, SmsLogRecord>();
  const suppressed = new Map<string, SuppressionReason>();
  const ussd = new Map<string, UssdSessionRecord>();

  return {
    users: {
      async findById(id) {
        return users.get(id) ?? null;
      },
      async findByMsisdn(msisdn) {
        return [...users.values()].find((u) => u.msisdn === msisdn) ?? null;
      },
      async findBySubscriberId(subscriberId) {
        return [...users.values()].find((u) => u.subscriberId === subscriberId) ?? null;
      },
      async upsertVerified(input) {
        const existing = [...users.values()].find((u) => u.msisdn === input.msisdn);
        if (existing) {
          existing.subscriberId = input.subscriberId ?? existing.subscriberId;
          existing.applinkSubscriptionStatus =
            input.subscriptionStatus ?? existing.applinkSubscriptionStatus;
          return existing;
        }
        const user: UserRecord = {
          id: `usr_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
          msisdn: input.msisdn,
          accountType: input.accountType,
          isAdmin: false,
          subscriberId: input.subscriberId,
          applinkSubscriptionStatus: input.subscriptionStatus,
          createdAt: new Date(),
        };
        users.set(user.id, user);
        return user;
      },
    },

    otpSessions: {
      async create(input) {
        for (const s of otpSessions.values()) {
          if (s.msisdn === input.msisdn && s.consumedAt === null) s.consumedAt = new Date();
        }
        const session: OtpSessionRecord = {
          id: randomUUID(),
          ...input,
          attempts: 0,
          consumedAt: null,
          createdAt: new Date(),
        };
        otpSessions.set(session.id, session);
        return session;
      },
      async findOpen(msisdn, now) {
        const open = [...otpSessions.values()]
          .filter((s) => s.msisdn === msisdn && s.consumedAt === null && s.expiresAt > now)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return open[0] ?? null;
      },
      async incrementAttempts(id) {
        const s = otpSessions.get(id);
        if (!s) return Number.MAX_SAFE_INTEGER;
        s.attempts += 1;
        return s.attempts;
      },
      async consume(id, now) {
        const s = otpSessions.get(id);
        if (s) s.consumedAt = now;
      },
    },

    consents: {
      async record(input, now) {
        const row: ConsentRecord = { id: randomUUID(), ...input, createdAt: now };
        consents.push(row);
        return row;
      },
    },

    sessions: {
      async create(input) {
        const row: SessionRecord = { id: randomUUID(), ...input, revokedAt: null };
        sessions.set(row.id, row);
        return row;
      },
      async findByRefreshHash(hash) {
        return [...sessions.values()].find((s) => s.refreshHash === hash) ?? null;
      },
      async rotate(id, oldHash, newHash, expiresAt) {
        const s = sessions.get(id);
        if (!s || s.revokedAt !== null || s.refreshHash !== oldHash) return false;
        s.refreshHash = newHash;
        s.expiresAt = expiresAt;
        return true;
      },
      async revoke(id, now) {
        const s = sessions.get(id);
        if (s) s.revokedAt = now;
      },
    },

    dedupe: {
      async firstSeen(key, now) {
        if (seen.has(key)) return false;
        seen.set(key, now.getTime());
        return true;
      },
    },

    smsLog: {
      async create(input, now) {
        const existing = smsLog.get(input.idempotencyKey);
        if (existing) return { record: existing, created: false };
        const record: SmsLogRecord = {
          id: randomUUID(),
          ...input,
          status: 'PENDING',
          requestId: null,
          applinkStatusCode: null,
          deliveryStatus: null,
          createdAt: now,
          updatedAt: now,
        };
        smsLog.set(input.idempotencyKey, record);
        return { record, created: true };
      },
      async findByIdempotencyKey(key) {
        return smsLog.get(key) ?? null;
      },
      async findByRequestId(requestId) {
        return [...smsLog.values()].find((r) => r.requestId === requestId) ?? null;
      },
      async update(id, patch, now) {
        const row = [...smsLog.values()].find((r) => r.id === id);
        if (!row) return null;
        Object.assign(row, patch, { updatedAt: now });
        return row;
      },
      async recentForSubscriber(subscriberId, limit) {
        return [...smsLog.values()]
          .filter((r) => r.subscriberId === subscriberId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit);
      },
    },

    optOuts: {
      async suppress(input) {
        // STOP outranks the others: it is a withdrawn consent, not a delivery problem.
        if (suppressed.get(input.subscriberId) !== 'STOP') {
          suppressed.set(input.subscriberId, input.reason);
        }
      },
      async suppressionFor(subscriberId) {
        return suppressed.get(subscriberId) ?? null;
      },
    },

    ussdSessions: {
      async get(sessionId, now) {
        const s = ussd.get(sessionId);
        if (!s) return null;
        if (s.expiresAt <= now) {
          ussd.delete(sessionId);
          return null;
        }
        return s;
      },
      async put(record) {
        ussd.set(record.sessionId, record);
      },
      async delete(sessionId) {
        ussd.delete(sessionId);
      },
    },

    rateLimit: {
      async hit(key, limit, windowMs, now) {
        const t = now.getTime();
        const recent = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
        if (recent.length >= limit) {
          hits.set(key, recent);
          const oldest = recent[0] ?? t;
          return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - t) / 1000) };
        }
        recent.push(t);
        hits.set(key, recent);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
  };
}
