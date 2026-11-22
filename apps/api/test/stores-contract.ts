import { describe, expect, it } from 'vitest';
import type { Stores, UserRecord } from '../src/stores/types.js';

export interface StoresUnderTest {
  stores: Stores;
  cleanup(): Promise<void>;
}

const T0 = new Date('2026-11-22T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
let n = 0;
const uniq = (p: string) => `${p}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const msisdn = () => `8801${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

async function user(stores: Stores, over: Partial<{ subscriberId: string | null }> = {}) {
  return stores.users.upsertVerified({
    msisdn: msisdn(),
    accountType: 'INDIVIDUAL',
    subscriberId: over.subscriberId === undefined ? uniq('tel:880') : over.subscriberId,
    subscriptionStatus: 'REGISTERED',
  });
}

/** Behaviour every Stores implementation must share. */
export function storesContract(label: string, make: () => Promise<StoresUnderTest>): void {
  describe(`${label} stores contract`, { timeout: 30_000 }, () => {
    const withStores = async (fn: (s: Stores) => Promise<void>) => {
      const t = await make();
      try {
        await fn(t.stores);
      } finally {
        await t.cleanup();
      }
    };

    it('users: upsert, lookups, and re-verify keeps the same account', () =>
      withStores(async (s) => {
        const m = msisdn();
        const sid = uniq('tel:880');
        const a = await s.users.upsertVerified({
          msisdn: m,
          accountType: 'PHARMACY',
          subscriberId: sid,
          subscriptionStatus: 'REGISTERED',
        });
        expect(a).toMatchObject({
          msisdn: m,
          accountType: 'PHARMACY',
          subscriberId: sid,
          isAdmin: false,
        });
        expect(a.id).toMatch(/^usr_/);

        // Verifying again: same account, account type is not changed, new status is recorded.
        const b = await s.users.upsertVerified({
          msisdn: m,
          accountType: 'INDIVIDUAL',
          subscriberId: null,
          subscriptionStatus: 'TRIAL',
        });
        expect(b.id).toBe(a.id);
        expect(b.accountType).toBe('PHARMACY');
        expect(b.subscriberId).toBe(sid); // null does not erase a known id
        expect(b.applinkSubscriptionStatus).toBe('TRIAL');

        expect((await s.users.findByMsisdn(m))?.id).toBe(a.id);
        expect((await s.users.findBySubscriberId(sid))?.id).toBe(a.id);
        expect((await s.users.findById(a.id))?.msisdn).toBe(m);
        expect(await s.users.findByMsisdn('8801000000000')).toBeNull();
        expect(await s.users.findBySubscriberId('nope')).toBeNull();
        expect(await s.users.findById('usr_nope')).toBeNull();
      }));

    it('otp sessions: newest open one wins, older ones are closed, attempts count, expiry honoured', () =>
      withStores(async (s) => {
        const m = msisdn();
        const first = await s.otpSessions.create({
          msisdn: m,
          purpose: 'SIGNUP',
          referenceNo: 'ref-1',
          expiresAt: at(300),
        });
        const second = await s.otpSessions.create({
          msisdn: m,
          purpose: 'SIGNUP',
          referenceNo: 'ref-2',
          expiresAt: at(300),
        });
        const open = await s.otpSessions.findOpen(m, at(10));
        expect(open?.id).toBe(second.id);
        expect(open?.referenceNo).toBe('ref-2');
        expect(open?.msisdn).toBe(m);
        expect(first.id).not.toBe(second.id);

        expect(await s.otpSessions.incrementAttempts(second.id)).toBe(1);
        expect(await s.otpSessions.incrementAttempts(second.id)).toBe(2);

        expect(await s.otpSessions.findOpen(m, at(301))).toBeNull(); // expired
        await s.otpSessions.consume(second.id, at(20));
        expect(await s.otpSessions.findOpen(m, at(30))).toBeNull(); // consumed
        expect(await s.otpSessions.findOpen(msisdn(), at(30))).toBeNull(); // other number
      }));

    it('consents: record keeps the evidence, hasKind is per user and kind', () =>
      withStores(async (s) => {
        const u = await user(s);
        const other = await user(s);
        const c = await s.consents.record(
          {
            userId: u.id,
            kind: 'FAMILY_CIRCLE_V1',
            channel: 'APP',
            ip: '10.0.0.1',
            wording: 'I agree to pay 30 BDT monthly',
            amount: '30.00',
            currency: 'BDT',
            frequency: 'monthly',
          },
          at(0),
        );
        expect(c).toMatchObject({
          userId: u.id,
          wording: 'I agree to pay 30 BDT monthly',
          amount: '30.00',
        });
        await s.consents.record(
          { msisdn: msisdn(), kind: 'SIGNUP_OTP_V1', channel: 'APP', ip: null },
          at(1),
        );
        expect(await s.consents.hasKind(u.id, 'FAMILY_CIRCLE_V1')).toBe(true);
        expect(await s.consents.hasKind(u.id, 'PHARMACY_V1')).toBe(false);
        expect(await s.consents.hasKind(other.id, 'FAMILY_CIRCLE_V1')).toBe(false);
      }));

    it('sessions: refresh rotates once, the old token dies, revoke blocks rotation', () =>
      withStores(async (s) => {
        const u = await user(s);
        const row = await s.sessions.create({
          userId: u.id,
          refreshHash: 'h1',
          expiresAt: at(1000),
        });
        expect((await s.sessions.findByRefreshHash('h1'))?.id).toBe(row.id);

        // Two refreshes with the same token race: exactly one wins.
        const results = await Promise.all([
          s.sessions.rotate(row.id, 'h1', 'h2', at(2000)),
          s.sessions.rotate(row.id, 'h1', 'h3', at(2000)),
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await s.sessions.findByRefreshHash('h1')).toBeNull();

        const winner = results[0] ? 'h2' : 'h3';
        const cur = await s.sessions.findByRefreshHash(winner);
        expect(cur?.expiresAt.getTime()).toBe(at(2000).getTime());
        await s.sessions.revoke(row.id, at(5));
        expect(await s.sessions.rotate(row.id, winner, 'h4', at(3000))).toBe(false);
        expect((await s.sessions.findByRefreshHash(winner))?.revokedAt).not.toBeNull();
      }));

    it('dedupe: a key is first seen exactly once, even under concurrency', () =>
      withStores(async (s) => {
        const key = uniq('k');
        const out = await Promise.all(
          Array.from({ length: 8 }, () => s.dedupe.firstSeen(key, at(0))),
        );
        expect(out.filter(Boolean)).toHaveLength(1);
        expect(await s.dedupe.firstSeen(key, at(5))).toBe(false);
        expect(await s.dedupe.firstSeen(uniq('k'), at(5))).toBe(true);
      }));

    it('sms log: idempotent create, patching, lookups by request id, newest first', () =>
      withStores(async (s) => {
        const sid = uniq('tel:880');
        const key = uniq('idem');
        const a = await s.smsLog.create(
          { idempotencyKey: key, subscriberId: sid, purpose: 'REMINDER', critical: true },
          at(0),
        );
        expect(a.created).toBe(true);
        expect(a.record).toMatchObject({ status: 'PENDING', critical: true, requestId: null });
        const again = await s.smsLog.create(
          { idempotencyKey: key, subscriberId: sid, purpose: 'X', critical: false },
          at(1),
        );
        expect(again.created).toBe(false);
        expect(again.record.id).toBe(a.record.id);
        expect(again.record.purpose).toBe('REMINDER');

        const rid = uniq('req');
        const upd = await s.smsLog.update(
          a.record.id,
          { status: 'SUBMITTED', requestId: rid, applinkStatusCode: 'S1000' },
          at(2),
        );
        expect(upd).toMatchObject({
          status: 'SUBMITTED',
          requestId: rid,
          applinkStatusCode: 'S1000',
        });
        await s.smsLog.update(a.record.id, { deliveryStatus: 'DELIVERED' }, at(3));
        const found = await s.smsLog.findByRequestId(rid);
        expect(found).toMatchObject({ status: 'SUBMITTED', deliveryStatus: 'DELIVERED' }); // earlier fields kept
        expect((await s.smsLog.findByIdempotencyKey(key))?.id).toBe(a.record.id);
        expect(await s.smsLog.findByRequestId('missing')).toBeNull();
        expect(
          await s.smsLog.update(
            '00000000-0000-0000-0000-000000000000',
            { status: 'FAILED' },
            at(4),
          ),
        ).toBeNull();

        const b = await s.smsLog.create(
          { idempotencyKey: uniq('idem'), subscriberId: sid, purpose: 'REMINDER', critical: false },
          at(10),
        );
        const recent = await s.smsLog.recentForSubscriber(sid, 5);
        expect(recent.map((r) => r.id)).toEqual([b.record.id, a.record.id]);
        expect(await s.smsLog.recentForSubscriber(sid, 1)).toHaveLength(1);
      }));

    it('subscriptions mirror: merge upsert leaves untouched fields alone; stale list', () =>
      withStores(async (s) => {
        const u = await user(s);
        const sid = uniq('tel:880');
        const created = await s.subscriptions.upsert(
          {
            subscriberId: sid,
            userId: u.id,
            status: 'REG_PENDING',
            plan: 'FAMILY_CIRCLE',
            registerRequestedAt: at(0),
          },
          at(0),
        );
        expect(created).toMatchObject({
          status: 'REG_PENDING',
          plan: 'FAMILY_CIRCLE',
          lastConfirmedAt: null,
        });

        const confirmed = await s.subscriptions.upsert(
          {
            subscriberId: sid,
            status: 'REGISTERED',
            frequency: 'monthly',
            confirmedAt: at(60),
            confirmedBy: 'NOTIFICATION',
          },
          at(60),
        );
        expect(confirmed).toMatchObject({
          status: 'REGISTERED',
          frequency: 'monthly',
          plan: 'FAMILY_CIRCLE', // untouched
          userId: u.id, // untouched
          confirmedBy: 'NOTIFICATION',
        });
        expect(confirmed.registerRequestedAt?.getTime()).toBe(at(0).getTime());
        expect((await s.subscriptions.get(sid))?.status).toBe('REGISTERED');
        expect((await s.subscriptions.findByUserId(u.id))?.subscriberId).toBe(sid);
        expect(await s.subscriptions.get('nope')).toBeNull();

        const never = uniq('tel:880');
        await s.subscriptions.upsert({ subscriberId: never, status: 'REGISTERED' }, at(70));
        const stale = await s.subscriptions.listStale(at(1000), 50);
        expect(stale.map((r) => r.subscriberId)).toContain(never);
        expect(stale.map((r) => r.subscriberId)).toContain(sid);
        const fresh = await s.subscriptions.listStale(at(30), 50);
        expect(fresh.map((r) => r.subscriberId)).not.toContain(sid); // confirmed at 60, after the cut-off
      }));

    it('charges: ledger row first, patching, attempts, open list, duplicate id refused', () =>
      withStores(async (s) => {
        const u = await user(s);
        const id = uniq('trx');
        const c = await s.charges.create(
          {
            externalTrxId: id,
            userId: u.id,
            subscriberId: 'tel:880x',
            purpose: 'DOCTOR_SUMMARY',
            amount: '5.00',
            currency: 'BDT',
          },
          at(0),
        );
        expect(c).toMatchObject({
          status: 'PENDING',
          amount: '5.00',
          otpAttempts: 0,
          requestCorrelator: null,
        });
        await expect(
          s.charges.create(
            {
              externalTrxId: id,
              userId: u.id,
              subscriberId: 'x',
              purpose: 'p',
              amount: '5.00',
              currency: 'BDT',
            },
            at(1),
          ),
        ).rejects.toThrow();

        const sent = await s.charges.update(
          id,
          { status: 'OTP_SENT', requestCorrelator: 'corr-1', internalTrxId: 'int-1' },
          at(5),
        );
        expect(sent).toMatchObject({
          status: 'OTP_SENT',
          requestCorrelator: 'corr-1',
          internalTrxId: 'int-1',
          amount: '5.00',
        });
        expect(await s.charges.incrementOtpAttempts(id)).toBe(1);
        expect(await s.charges.incrementOtpAttempts(id)).toBe(2);
        expect((await s.charges.get(id))?.otpAttempts).toBe(2);
        expect(await s.charges.get('nope')).toBeNull();
        expect(await s.charges.update('nope', { status: 'FAILED' }, at(6))).toBeNull();

        expect((await s.charges.listOpen(at(100), 50)).map((r) => r.externalTrxId)).toContain(id);
        expect((await s.charges.listOpen(at(3), 50)).map((r) => r.externalTrxId)).not.toContain(id); // touched at 5
        await s.charges.update(
          id,
          { status: 'SETTLED', paidAmount: '5.00', balanceDue: '0', fulfilledAt: at(9) },
          at(9),
        );
        expect((await s.charges.listOpen(at(1000), 50)).map((r) => r.externalTrxId)).not.toContain(
          id,
        );
        expect((await s.charges.get(id))?.fulfilledAt?.getTime()).toBe(at(9).getTime());
      }));

    it('entitlements: a charge grants once; credits are spent atomically', () =>
      withStores(async (s) => {
        const u = await user(s);
        const mk = async (id: string) =>
          s.charges.create(
            {
              externalTrxId: id,
              userId: u.id,
              subscriberId: 'x',
              purpose: 'p',
              amount: '5.00',
              currency: 'BDT',
            },
            at(0),
          );
        const c1 = uniq('trx');
        const c2 = uniq('trx');
        await mk(c1);
        await mk(c2);

        expect(
          await s.entitlements.grant(
            { userId: u.id, feature: 'DOCTOR_SUMMARY', quantity: 2, chargeId: c1 },
            at(1),
          ),
        ).toEqual({ granted: true });
        expect(
          await s.entitlements.grant(
            { userId: u.id, feature: 'DOCTOR_SUMMARY', quantity: 2, chargeId: c1 },
            at(2),
          ),
        ).toEqual({ granted: false });
        expect(await s.entitlements.available(u.id, 'DOCTOR_SUMMARY')).toBe(2);
        await s.entitlements.grant(
          { userId: u.id, feature: 'DOCTOR_SUMMARY', quantity: 1, chargeId: c2 },
          at(3),
        );
        expect(await s.entitlements.available(u.id, 'DOCTOR_SUMMARY')).toBe(3);
        expect(await s.entitlements.available(u.id, 'OTHER')).toBe(0);

        // Five requests race for three credits: exactly three win.
        const spent = await Promise.all(
          Array.from({ length: 5 }, () => s.entitlements.consume(u.id, 'DOCTOR_SUMMARY')),
        );
        expect(spent.filter(Boolean)).toHaveLength(3);
        expect(await s.entitlements.available(u.id, 'DOCTOR_SUMMARY')).toBe(0);
        expect(await s.entitlements.consume(u.id, 'DOCTOR_SUMMARY')).toBe(false);
      }));

    it('usage counters: per user, counter and period; concurrent increments add up', () =>
      withStores(async (s) => {
        const u = await user(s);
        expect(await s.usage.get(u.id, 'SCAN', '2026-11')).toBe(0);
        expect(await s.usage.increment(u.id, 'SCAN', '2026-11')).toBe(1);
        expect(await s.usage.increment(u.id, 'SCAN', '2026-11', 4)).toBe(5);
        await Promise.all(
          Array.from({ length: 6 }, () => s.usage.increment(u.id, 'SCAN', '2026-11')),
        );
        expect(await s.usage.get(u.id, 'SCAN', '2026-11')).toBe(11);
        expect(await s.usage.get(u.id, 'SCAN', '2026-12')).toBe(0);
        expect(await s.usage.get(u.id, 'SMS', '2026-11')).toBe(0);
      }));

    it('usage counters: incrementIfBelow stops exactly at the limit, even under a race', () =>
      withStores(async (s) => {
        const u = await user(s);
        expect(await s.usage.incrementIfBelow(u.id, 'SCAN', '2026-11', 0)).toBeNull(); // no allowance at all
        expect(await s.usage.get(u.id, 'SCAN', '2026-11')).toBe(0);

        expect(await s.usage.incrementIfBelow(u.id, 'SCAN', '2026-11', 2)).toBe(1);
        expect(await s.usage.incrementIfBelow(u.id, 'SCAN', '2026-11', 2)).toBe(2);
        expect(await s.usage.incrementIfBelow(u.id, 'SCAN', '2026-11', 2)).toBeNull();
        expect(await s.usage.get(u.id, 'SCAN', '2026-11')).toBe(2);

        // Ten requests race for three units: exactly three win.
        const won = await Promise.all(
          Array.from({ length: 10 }, () => s.usage.incrementIfBelow(u.id, 'SMS', '2026-11', 3)),
        );
        expect(won.filter((v) => v !== null)).toHaveLength(3);
        expect(await s.usage.get(u.id, 'SMS', '2026-11')).toBe(3);
      }));

    it('maintenance: purges rows past retention and keeps the rest, consent included', () =>
      withStores(async (s) => {
        const DAY = 24 * 60 * 60 * 1000;
        const now = new Date('2027-03-01T00:00:00Z');
        const ago = (days: number) => new Date(now.getTime() - days * DAY);
        const u = await user(s);

        const oldSms = await s.smsLog.create(
          { idempotencyKey: uniq('i'), subscriberId: 'x', purpose: 'p', critical: false },
          ago(91),
        );
        const newSms = await s.smsLog.create(
          { idempotencyKey: uniq('i'), subscriberId: 'x', purpose: 'p', critical: false },
          ago(89),
        );
        const oldKey = uniq('d');
        const newKey = uniq('d');
        await s.dedupe.firstSeen(oldKey, ago(31));
        await s.dedupe.firstSeen(newKey, ago(29));

        const m1 = msisdn();
        await s.otpSessions.create({
          msisdn: m1,
          purpose: 'SIGNUP',
          referenceNo: 'r',
          expiresAt: new Date(now.getTime() - 25 * 3600_000),
        });
        const m2 = msisdn();
        await s.otpSessions.create({
          msisdn: m2,
          purpose: 'SIGNUP',
          referenceNo: 'r',
          expiresAt: new Date(now.getTime() - 23 * 3600_000),
        });

        const ended = await s.sessions.create({
          userId: u.id,
          refreshHash: uniq('h'),
          expiresAt: ago(31),
        });
        const live = await s.sessions.create({
          userId: u.id,
          refreshHash: uniq('h'),
          expiresAt: new Date(now.getTime() + 30 * DAY),
        });
        const revoked = await s.sessions.create({
          userId: u.id,
          refreshHash: uniq('h'),
          expiresAt: new Date(now.getTime() + 30 * DAY),
        });
        await s.sessions.revoke(revoked.id, ago(31));

        const hitKey = uniq('rl');
        await s.rateLimit.hit(hitKey, 99, 3 * DAY, ago(2));
        await s.rateLimit.hit(hitKey, 99, 3 * DAY, new Date(now.getTime() - 3600_000));

        await s.consents.record(
          { userId: u.id, kind: 'FAMILY_CIRCLE_V1', channel: 'APP', ip: null },
          ago(400),
        );

        const counts = await s.maintenance.purge(now);
        expect(counts.smsLog).toBeGreaterThanOrEqual(1);
        expect(counts.callbackDedupe).toBeGreaterThanOrEqual(1);
        expect(counts.otpSessions).toBeGreaterThanOrEqual(1);
        expect(counts.rateLimitHits).toBeGreaterThanOrEqual(1);
        expect(counts.sessions).toBeGreaterThanOrEqual(2);

        expect(await s.smsLog.findByIdempotencyKey(oldSms.record.idempotencyKey)).toBeNull();
        expect(await s.smsLog.findByIdempotencyKey(newSms.record.idempotencyKey)).not.toBeNull();
        expect(await s.dedupe.firstSeen(oldKey, now)).toBe(true); // forgotten, so first seen again
        expect(await s.dedupe.firstSeen(newKey, now)).toBe(false); // still remembered
        expect(
          await s.otpSessions.findOpen(m2, new Date(now.getTime() - 24 * 3600_000)),
        ).not.toBeNull();
        expect(await s.sessions.findByRefreshHash(ended.refreshHash)).toBeNull();
        expect(await s.sessions.findByRefreshHash(revoked.refreshHash)).toBeNull();
        expect(await s.sessions.findByRefreshHash(live.refreshHash)).not.toBeNull();
        // Consent is evidence: kept.
        expect(await s.consents.hasKind(u.id, 'FAMILY_CIRCLE_V1')).toBe(true);
        // A second run has nothing left to do.
        expect(await s.maintenance.purge(now)).toEqual({
          smsLog: 0,
          callbackDedupe: 0,
          otpSessions: 0,
          rateLimitHits: 0,
          sessions: 0,
        });
      }));

    it('opt-outs: STOP is never downgraded, a dead number can be upgraded to STOP', () =>
      withStores(async (s) => {
        const a = uniq('tel:880');
        expect(await s.optOuts.suppressionFor(a)).toBeNull();
        await s.optOuts.suppress({ subscriberId: a, reason: 'STOP', source: 'SMS' }, at(0));
        await s.optOuts.suppress(
          { subscriberId: a, reason: 'DEAD_NUMBER', source: 'SYSTEM' },
          at(1),
        );
        expect(await s.optOuts.suppressionFor(a)).toBe('STOP');

        const b = uniq('tel:880');
        await s.optOuts.suppress(
          { subscriberId: b, reason: 'DEAD_NUMBER', source: 'SYSTEM' },
          at(0),
        );
        expect(await s.optOuts.suppressionFor(b)).toBe('DEAD_NUMBER');
        await s.optOuts.suppress({ subscriberId: b, reason: 'STOP', source: 'APP' }, at(1));
        expect(await s.optOuts.suppressionFor(b)).toBe('STOP');
      }));

    it('erase: removes everything about a person, anonymises charges, keeps the STOP entry', () =>
      withStores(async (s) => {
        const m = msisdn();
        const sid = uniq('tel:880');
        const u = await s.users.upsertVerified({
          msisdn: m,
          accountType: 'INDIVIDUAL',
          subscriberId: sid,
          subscriptionStatus: 'REGISTERED',
        });
        const other = await user(s);

        // Everything a person leaves behind.
        await s.sessions.create({ userId: u.id, refreshHash: uniq('h'), expiresAt: at(1000) });
        await s.consents.record(
          { userId: u.id, kind: 'FAMILY_CIRCLE_V1', channel: 'APP', ip: '1.2.3.4', wording: 'w' },
          at(0),
        );
        await s.consents.record(
          { msisdn: m, kind: 'SIGNUP_OTP_V1', channel: 'APP', ip: null },
          at(0),
        );
        await s.otpSessions.create({
          msisdn: m,
          purpose: 'SIGNUP',
          referenceNo: 'r',
          expiresAt: at(300),
        });
        const sms = await s.smsLog.create(
          { idempotencyKey: uniq('i'), subscriberId: sid, purpose: 'p', critical: false },
          at(0),
        );
        await s.subscriptions.upsert(
          { subscriberId: sid, userId: u.id, status: 'REGISTERED' },
          at(0),
        );
        const trx = uniq('trx');
        await s.charges.create(
          {
            externalTrxId: trx,
            userId: u.id,
            subscriberId: sid,
            purpose: 'SCAN',
            amount: '5.00',
            currency: 'BDT',
          },
          at(0),
        );
        await s.entitlements.grant(
          { userId: u.id, feature: 'SCAN', quantity: 1, chargeId: trx },
          at(0),
        );
        await s.usage.increment(u.id, 'SCAN', '2026-11');
        await s.optOuts.suppress({ subscriberId: sid, reason: 'STOP', source: 'APP' }, at(0));

        // Someone else's data must be untouched.
        const otherSms = await s.smsLog.create(
          {
            idempotencyKey: uniq('i'),
            subscriberId: other.subscriberId ?? 'x',
            purpose: 'p',
            critical: false,
          },
          at(0),
        );
        await s.usage.increment(other.id, 'SCAN', '2026-11');

        await s.users.erase(u.id);

        expect(await s.users.findById(u.id)).toBeNull();
        expect(await s.users.findByMsisdn(m)).toBeNull();
        expect(await s.users.findBySubscriberId(sid)).toBeNull();
        expect(await s.otpSessions.findOpen(m, at(10))).toBeNull();
        expect(await s.consents.hasKind(u.id, 'FAMILY_CIRCLE_V1')).toBe(false);
        expect(await s.smsLog.findByIdempotencyKey(sms.record.idempotencyKey)).toBeNull();
        expect(await s.subscriptions.get(sid)).toBeNull();
        expect(await s.entitlements.available(u.id, 'SCAN')).toBe(0);
        expect(await s.usage.get(u.id, 'SCAN', '2026-11')).toBe(0);

        // The ledger survives, with no link to a person.
        expect(await s.charges.get(trx)).toMatchObject({
          userId: null,
          subscriberId: 'erased',
          amount: '5.00',
          purpose: 'SCAN',
        });
        // The opt-out is kept so the number is never messaged again.
        expect(await s.optOuts.suppressionFor(sid)).toBe('STOP');

        expect(await s.smsLog.findByIdempotencyKey(otherSms.record.idempotencyKey)).not.toBeNull();
        expect(await s.usage.get(other.id, 'SCAN', '2026-11')).toBe(1);
        await s.users.erase(u.id); // erasing twice is harmless
        await s.users.erase('usr_does_not_exist');
      }));

    it('opt-outs: clearStop lifts a STOP but never a block or a dead number', () =>
      withStores(async (s) => {
        const stop = uniq('tel:880');
        await s.optOuts.suppress({ subscriberId: stop, reason: 'STOP', source: 'SMS' }, at(0));
        await s.optOuts.clearStop(stop);
        expect(await s.optOuts.suppressionFor(stop)).toBeNull();

        const blocked = uniq('tel:880');
        await s.optOuts.suppress(
          { subscriberId: blocked, reason: 'BLOCKED', source: 'SYSTEM' },
          at(0),
        );
        await s.optOuts.clearStop(blocked);
        expect(await s.optOuts.suppressionFor(blocked)).toBe('BLOCKED');

        const dead = uniq('tel:880');
        await s.optOuts.suppress(
          { subscriberId: dead, reason: 'DEAD_NUMBER', source: 'SYSTEM' },
          at(0),
        );
        await s.optOuts.clearStop(dead);
        expect(await s.optOuts.suppressionFor(dead)).toBe('DEAD_NUMBER');
        await s.optOuts.clearStop(uniq('tel:880')); // unknown number: nothing happens
      }));

    it('rate limit: allows up to the limit, then refuses with a retry time; the window slides; races are safe', () =>
      withStores(async (s) => {
        const key = uniq('rl');
        for (let i = 0; i < 3; i++) {
          expect((await s.rateLimit.hit(key, 3, 60_000, at(i))).allowed).toBe(true);
        }
        const denied = await s.rateLimit.hit(key, 3, 60_000, at(10));
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterSeconds).toBe(50); // oldest hit at 0 leaves the window at 60
        expect((await s.rateLimit.hit(key, 3, 60_000, at(61))).allowed).toBe(true); // slid past the first hit

        const raced = uniq('rl');
        const out = await Promise.all(
          Array.from({ length: 10 }, () => s.rateLimit.hit(raced, 3, 60_000, at(0))),
        );
        expect(out.filter((r) => r.allowed)).toHaveLength(3);
      }));
  });
}

export type { UserRecord };
