import { randomUUID } from 'node:crypto';
import { RETENTION } from '../ops/retention.js';
import type {
  ChargeRecord,
  ConsentRecord,
  SubscriptionRecord,
  OtpSessionRecord,
  SessionRecord,
  SmsLogRecord,
  Stores,
  SuppressionReason,
  UserRecord,
} from './types.js';

/** In-memory stores: Day 1 only. State is lost on restart, so this is not for production data. */
export function createMemoryStores(): Stores {
  const users = new Map<string, UserRecord>();
  const otpSessions = new Map<string, OtpSessionRecord>();
  const consents: ConsentRecord[] = [];
  const subscriptions = new Map<string, SubscriptionRecord>();
  const charges = new Map<string, ChargeRecord>();
  const entitlements: {
    id: string;
    userId: string;
    feature: string;
    quantity: number;
    consumed: number;
    chargeId: string;
  }[] = [];
  const usage = new Map<string, number>();
  const sessions = new Map<string, SessionRecord>();
  const seen = new Map<string, number>();
  const hits = new Map<string, number[]>();
  const smsLog = new Map<string, SmsLogRecord>();
  const suppressed = new Map<string, SuppressionReason>();

  return {
    users: {
      async findById(id) {
        return users.get(id) ?? null;
      },
      async findByMsisdn(msisdn) {
        return [...users.values()].find((u) => u.msisdn === msisdn) ?? null;
      },
      async erase(userId) {
        const user = users.get(userId);
        if (!user) return;
        const sub = user.subscriberId;
        for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
        for (let i = consents.length - 1; i >= 0; i--) {
          if (
            consents[i]?.userId === userId ||
            (consents[i]?.msisdn && consents[i]?.msisdn === user.msisdn)
          ) {
            consents.splice(i, 1);
          }
        }
        for (const [id, s] of otpSessions) if (s.msisdn === user.msisdn) otpSessions.delete(id);
        if (sub) {
          for (const [k, r] of smsLog) if (r.subscriberId === sub) smsLog.delete(k);
          subscriptions.delete(sub);
        }
        for (const sRow of [...subscriptions.values()])
          if (sRow.userId === userId) subscriptions.delete(sRow.subscriberId);
        for (const c of charges.values()) {
          if (c.userId === userId) {
            c.userId = null;
            c.subscriberId = 'erased';
          }
        }
        for (let i = entitlements.length - 1; i >= 0; i--) {
          if (entitlements[i]?.userId === userId) entitlements.splice(i, 1);
        }
        for (const k of [...usage.keys()]) if (k.startsWith(`${userId}|`)) usage.delete(k);
        users.delete(userId);
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
        const row: ConsentRecord = {
          id: randomUUID(),
          userId: input.userId ?? null,
          msisdn: input.msisdn ?? null,
          kind: input.kind,
          channel: input.channel,
          ip: input.ip,
          wording: input.wording ?? null,
          amount: input.amount ?? null,
          currency: input.currency ?? null,
          frequency: input.frequency ?? null,
          createdAt: now,
        };
        consents.push(row);
        return row;
      },
      async hasKind(userId, kind) {
        return consents.some((c) => c.userId === userId && c.kind === kind);
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

    subscriptions: {
      async get(subscriberId) {
        return subscriptions.get(subscriberId) ?? null;
      },
      async findByUserId(userId) {
        return [...subscriptions.values()].find((r) => r.userId === userId) ?? null;
      },
      async upsert(patch, now) {
        const prev = subscriptions.get(patch.subscriberId);
        const next: SubscriptionRecord = prev ?? {
          subscriberId: patch.subscriberId,
          userId: null,
          status: 'INITIAL',
          frequency: null,
          plan: null,
          registerRequestedAt: null,
          lastConfirmedAt: null,
          confirmedBy: null,
          updatedAt: now,
        };
        if (patch.userId !== undefined) next.userId = patch.userId;
        if (patch.status !== undefined) next.status = patch.status;
        if (patch.frequency !== undefined) next.frequency = patch.frequency;
        if (patch.plan !== undefined) next.plan = patch.plan;
        if (patch.registerRequestedAt !== undefined) {
          next.registerRequestedAt = patch.registerRequestedAt;
        }
        if (patch.confirmedAt !== undefined) next.lastConfirmedAt = patch.confirmedAt;
        if (patch.confirmedBy !== undefined) next.confirmedBy = patch.confirmedBy;
        next.updatedAt = now;
        subscriptions.set(next.subscriberId, next);
        return next;
      },
      async listStale(before, limit) {
        return [...subscriptions.values()]
          .filter((r) => r.lastConfirmedAt === null || r.lastConfirmedAt < before)
          .slice(0, limit);
      },
    },

    charges: {
      async create(input, now) {
        const row: ChargeRecord = {
          ...input,
          status: 'PENDING',
          requestCorrelator: null,
          internalTrxId: null,
          referenceId: null,
          paidAmount: null,
          balanceDue: null,
          otpAttempts: 0,
          fulfilledAt: null,
          createdAt: now,
          updatedAt: now,
        };
        if (charges.has(row.externalTrxId)) throw new Error('duplicate externalTrxId');
        charges.set(row.externalTrxId, row);
        return row;
      },
      async get(externalTrxId) {
        return charges.get(externalTrxId) ?? null;
      },
      async update(externalTrxId, patch, now) {
        const row = charges.get(externalTrxId);
        if (!row) return null;
        Object.assign(row, patch, { updatedAt: now });
        return row;
      },
      async incrementOtpAttempts(externalTrxId) {
        const row = charges.get(externalTrxId);
        if (!row) return Number.MAX_SAFE_INTEGER;
        row.otpAttempts += 1;
        return row.otpAttempts;
      },
      async listOpen(olderThan, limit) {
        return [...charges.values()]
          .filter(
            (c) =>
              ['PENDING', 'OTP_SENT', 'PROCESSING', 'PARTIAL'].includes(c.status) &&
              c.updatedAt < olderThan,
          )
          .slice(0, limit);
      },
    },

    entitlements: {
      async grant(input, now) {
        void now;
        if (entitlements.some((e) => e.chargeId === input.chargeId)) return { granted: false };
        entitlements.push({
          id: randomUUID(),
          userId: input.userId,
          feature: input.feature,
          quantity: input.quantity,
          consumed: 0,
          chargeId: input.chargeId,
        });
        return { granted: true };
      },
      async available(userId, feature) {
        return entitlements
          .filter((e) => e.userId === userId && e.feature === feature)
          .reduce((n, e) => n + (e.quantity - e.consumed), 0);
      },
      async consume(userId, feature) {
        const row = entitlements.find(
          (e) => e.userId === userId && e.feature === feature && e.consumed < e.quantity,
        );
        if (!row) return false;
        row.consumed += 1;
        return true;
      },
    },

    usage: {
      async get(userId, counter, period) {
        return usage.get(`${userId}|${counter}|${period}`) ?? 0;
      },
      async increment(userId, counter, period, by = 1) {
        const key = `${userId}|${counter}|${period}`;
        const next = (usage.get(key) ?? 0) + by;
        usage.set(key, next);
        return next;
      },
      async incrementIfBelow(userId, counter, period, limit) {
        const key = `${userId}|${counter}|${period}`;
        const current = usage.get(key) ?? 0;
        if (current >= limit) return null;
        usage.set(key, current + 1);
        return current + 1;
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
      async clearStop(subscriberId) {
        if (suppressed.get(subscriberId) === 'STOP') suppressed.delete(subscriberId);
      },
    },

    maintenance: {
      async purge(now) {
        const t = now.getTime();
        const drop = <K, V>(m: Map<K, V>, old: (v: V) => boolean): number => {
          let n = 0;
          for (const [k, v] of m) {
            if (old(v)) {
              m.delete(k);
              n++;
            }
          }
          return n;
        };
        const counts = {
          smsLog: drop(smsLog, (r) => r.createdAt.getTime() < t - RETENTION.smsLogMs),
          callbackDedupe: drop(seen, (at) => at < t - RETENTION.callbackDedupeMs),
          otpSessions: drop(
            otpSessions,
            (s) => s.expiresAt.getTime() < t - RETENTION.otpAfterExpiryMs,
          ),
          rateLimitHits: 0,
          // A session is over when revoked or expired, whichever came first.
          sessions: drop(
            sessions,
            (s) =>
              Math.min((s.revokedAt ?? s.expiresAt).getTime(), s.expiresAt.getTime()) <
              t - RETENTION.sessionAfterExpiryMs,
          ),
        };
        for (const [key, list] of hits) {
          const kept = list.filter((x) => x > t - RETENTION.rateLimitHitsMs);
          counts.rateLimitHits += list.length - kept.length;
          if (kept.length) hits.set(key, kept);
          else hits.delete(key);
        }
        return counts;
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
