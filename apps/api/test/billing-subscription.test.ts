import { describe, expect, it, vi } from 'vitest';
import { subscriptionStatusResponse } from '@uposhom/shared';
import { applinkError, fakeApplink, harness, ok, settle, SUB } from './platform.js';
import { ApplinkTransportError } from '@uposhom/applink-client';

const WORDING = 'I agree to pay 30 BDT every month. Renews automatically. Cancel any time.';
const subscribe = (h: Awaited<ReturnType<typeof harness>>, user: Parameters<typeof h.api>[0]) =>
  h.api(user, 'POST', '/billing/subscription/subscribe', {
    consentAccepted: true,
    consentWording: WORDING,
  });

const notify = (status: string, subscriberId = SUB, timeStamp = '20261122100000') => ({
  timeStamp,
  version: '1.0',
  applicationId: 'APP_1',
  password: 'SECRET-API-KEY',
  subscriberId,
  frequency: 'monthly',
  status,
});

/** Applink that registers successfully, answering with the given subscription status. */
const registering = (status = 'REGISTERED') =>
  fakeApplink({ register: async () => ok({ subscriptionStatus: status }) });

describe('Premium gate', () => {
  it('a free sign-up is REGISTERED at Applink but is not Premium', async () => {
    const h = await harness();
    const user = await h.addUser();
    // The notification Applink sends after the free OTP sign-up: REGISTERED, with no plan.
    await h.callback('subscription/notify', notify('REGISTERED'));
    await settle(h);

    expect((await h.stores.subscriptions.get(SUB))?.status).toBe('REGISTERED');
    const res = await h.api(user, 'GET', '/billing/subscription/status');
    expect(res.json().status).toBe('INACTIVE');
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('FREE');
    await h.app.close();
  });

  it('a notification alone never unlocks Premium, even with a plan consent on file', async () => {
    const h = await harness();
    const user = await h.addUser();
    await h.stores.consents.record(
      { userId: user.id, kind: 'FAMILY_CIRCLE_V1', channel: 'APP', ip: null },
      h.clock.now,
    );
    await h.callback('subscription/notify', notify('REGISTERED'));
    await settle(h);
    // Consent exists, status is active, but WE never called Register for the plan.
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    await h.app.close();
  });

  it('subscribes: consent is recorded BEFORE Register, then Premium is active', async () => {
    const order: string[] = [];
    const applink = fakeApplink({
      register: async () => {
        order.push('register');
        return ok({ subscriptionStatus: 'REGISTERED' });
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const record = h.stores.consents.record.bind(h.stores.consents);
    h.stores.consents.record = async (input, now) => {
      order.push('consent');
      return record(input, now);
    };

    const res = await subscribe(h, user);
    expect(order).toEqual(['consent', 'register']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ACTIVE',
      plan: 'FAMILY_CIRCLE',
      amount: '30.00',
      currency: 'BDT',
    });
    expect(subscriptionStatusResponse.safeParse(body).success).toBe(true);
    expect(applink.register).toHaveBeenCalledWith(SUB);

    expect(await h.app.services.subscriptions.isPremium(user)).toBe(true);
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('stores the consent evidence: wording, amount, currency, frequency, channel and IP', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    const spy = vi.spyOn(h.stores.consents, 'record');
    await subscribe(h, user);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        kind: 'FAMILY_CIRCLE_V1',
        channel: 'APP',
        wording: WORDING,
        amount: '30.00',
        currency: 'BDT',
        frequency: 'monthly',
      }),
      expect.any(Date),
    );
    await h.app.close();
  });

  it('refuses without consent and never calls Register', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    for (const payload of [
      {},
      { consentAccepted: false, consentWording: WORDING },
      { consentAccepted: true },
    ]) {
      const res = await h.api(user, 'POST', '/billing/subscription/subscribe', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CONSENT_REQUIRED');
    }
    expect(h.applink.register).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('subscribing again while Premium does nothing', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    await subscribe(h, user);
    await subscribe(h, user);
    expect(h.applink.register).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('REG_PENDING waits for the notification, which then activates it', async () => {
    const h = await harness({ applink: registering('REG_PENDING') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');

    await h.callback('subscription/notify', notify('REGISTERED'));
    await settle(h);
    const status = await h.api(user, 'GET', '/billing/subscription/status');
    expect(status.json().status).toBe('ACTIVE');
    expect((await h.stores.subscriptions.get(SUB))?.confirmedBy).toBe('NOTIFICATION');
    await h.app.close();
  });

  it('the pharmacy plan is chosen by account type', async () => {
    const h = await harness({ applink: registering() });
    const owner = await h.addUser('tel:pharm-1', {
      msisdn: '8801711111111',
      accountType: 'PHARMACY',
    });
    const res = await subscribe(h, owner);
    expect(res.json()).toMatchObject({ status: 'ACTIVE', plan: 'PHARMACY' });
    expect(await h.stores.consents.hasKind(owner.id, 'PHARMACY_V1')).toBe(true);
    await h.app.close();
  });

  it('maps Applink failures to stable codes, never raw ones', async () => {
    for (const [code, status, mapped] of [
      ['E1343', 403, 'NOT_ON_TEST_LIST'],
      ['E1342', 403, 'NUMBER_BLOCKED'],
      ['E1317', 422, 'NUMBER_NOT_ACCEPTED'],
      ['E1603', 503, 'SERVICE_TROUBLE'],
    ] as const) {
      const applink = fakeApplink({
        register: async () => {
          throw applinkError(code);
        },
      });
      const h = await harness({ applink });
      const user = await h.addUser();
      const res = await subscribe(h, user);
      expect(res.statusCode).toBe(status);
      expect(res.json().error.code).toBe(mapped);
      expect(res.body).not.toContain(code);
      await h.app.close();
    }
  });

  it('a timeout leaves it pending, because it may have gone through', async () => {
    const applink = fakeApplink({
      register: async () => {
        throw new ApplinkTransportError('timed out', 'subscription-register');
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.json().status).toBe('PENDING');
    expect(applink.register).toHaveBeenCalledTimes(1); // never retried blindly
    await h.app.close();
  });

  it('PENDING CONFIRMATION (live Register answer, with E1338) is pending, then active on the notification', async () => {
    const h = await harness({ applink: registering('PENDING CONFIRMATION') });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    expect((await h.stores.subscriptions.get(SUB))?.registerRequestedAt).not.toBeNull();

    // A second tap while waiting must not send a second Register.
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.register).toHaveBeenCalledTimes(1);

    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100500'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('INITIAL means Applink texted the person to confirm (reply A): pending, then active on the notification', async () => {
    const h = await harness({ applink: registering('INITIAL') });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('FREE');

    // A second tap while waiting must not send a second Register (and a second SMS).
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.register).toHaveBeenCalledTimes(1);

    // The person replies A; Applink's subscriber notification reports REGISTERED.
    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100500'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe('ACTIVE');
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('keeps PENDING when intermediate INITIAL or REG_PENDING notifications arrive, and does not re-register', async () => {
    const h = await harness({ applink: registering('INITIAL') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');

    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.callback('subscription/notify', notify('REG_PENDING', SUB, '20261122100100'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'PENDING',
    );
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.register).toHaveBeenCalledTimes(1);

    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100200'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe('ACTIVE');
    await h.app.close();
  });

  it('does not overwrite an in-flight REGISTERED notification with a stale INITIAL response', async () => {
    let resolveRegister!: (v: ReturnType<typeof ok<{ subscriptionStatus: string }>>) => void;
    const applink = fakeApplink({
      register: () =>
        new Promise((resolve) => {
          resolveRegister = resolve;
        }),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const pending = subscribe(h, user);

    await vi.waitFor(() => expect(applink.register).toHaveBeenCalledTimes(1));
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100001'));
    await settle(h);

    resolveRegister(ok({ subscriptionStatus: 'INITIAL' }));
    const res = await pending;
    expect(res.json().status).toBe('ACTIVE');
    expect((await h.stores.subscriptions.get(SUB))?.status).toBe('REGISTERED');
    await h.app.close();
  });

  it('an unconfirmed request lapses after Applink’s 60 minutes, and the person can ask again', async () => {
    const h = await harness({ applink: registering('UNREGISTERED.') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');

    h.clock.now = new Date(h.clock.now.getTime() + 61 * 60_000);
    // Never confirmed: back to the plan screen, not "cancelled", and never active.
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    await subscribe(h, user);
    expect(h.applink.register).toHaveBeenCalledTimes(2);
    await h.app.close();
  });

  it('a billing block from Register is a failure, and Premium stays shut', async () => {
    const h = await harness({ applink: registering('TEMPORARY_BLOCKED') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).statusCode).toBe(503);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).not.toBe(
      'ACTIVE',
    );
    await h.app.close();
  });

  it('a failed Register never makes a number REGISTERED at sign-up look Premium', async () => {
    const applink = fakeApplink({
      register: async () => {
        throw applinkError('E1603');
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    // Free OTP sign-up already made the number REGISTERED at Applink.
    await h.callback('subscription/notify', notify('REGISTERED'));
    await settle(h);
    expect((await subscribe(h, user)).statusCode).toBe(503);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('FREE');
    await h.app.close();
  });

  it('fails closed when Applink is not configured yet', async () => {
    const h = await harness({ applink: undefined });
    const user = await h.addUser();
    expect((await subscribe(h, user)).statusCode).toBe(503);
    await h.app.close();
  });

  it('requires a signed-in user', async () => {
    const h = await harness();
    for (const [method, url] of [
      ['GET', '/api/v1/billing/subscription/status'],
      ['POST', '/api/v1/billing/subscription/subscribe'],
      ['POST', '/api/v1/billing/subscription/unsubscribe'],
      ['GET', '/api/v1/billing/entitlements'],
      ['POST', '/api/v1/account/opt-out'],
    ] as const) {
      const res = await h.app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, url).toBe(401);
    }
    await h.app.close();
  });
});

describe('subscription lifecycle', () => {
  it('a billing failure (TEMPORARY_BLOCKED) keeps the account and shows the fix-payment path', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    await subscribe(h, user);
    await h.callback('subscription/notify', notify('TEMPORARY_BLOCKED', SUB, '20261122110000'));
    await settle(h);
    const body = (await h.api(user, 'GET', '/billing/subscription/status')).json();
    expect(body.status).toBe('INACTIVE');
    expect(body.billingIssue).toBe(true);
    expect(await h.stores.users.findById(user.id)).not.toBeNull(); // account is kept
    await h.app.close();
  });

  it('unsubscribing closes Premium at once, stops messages, and retries Unregister until it takes', async () => {
    let calls = 0;
    const applink = fakeApplink({
      register: async () => ok({ subscriptionStatus: 'REGISTERED' }),
      unregister: async () =>
        ok({ subscriptionStatus: ++calls < 2 ? 'REGISTERED' : 'UNREGISTERED' }),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    await subscribe(h, user);

    const res = await h.api(user, 'POST', '/billing/subscription/unsubscribe');
    expect(res.json().status).toBe('CANCELLED');
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');

    await settle(h);
    expect(calls).toBe(2);
    expect(h.queue.deadLetters?.()).toHaveLength(0);
    await h.app.close();
  });

  it('an operator or STOP removal arriving by notification suppresses the number', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('subscription/notify', notify('UNREGISTERED.'));
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    await h.app.close();
  });

  it('subscribing again with fresh consent lifts the STOP; a block is never lifted', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    await h.stores.optOuts.suppress(
      { subscriberId: SUB, reason: 'STOP', source: 'SMS' },
      h.clock.now,
    );
    await subscribe(h, user);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
    await h.app.close();

    const h2 = await harness({ applink: registering() });
    const user2 = await h2.addUser();
    await h2.stores.optOuts.suppress(
      { subscriberId: SUB, reason: 'BLOCKED', source: 'SYSTEM' },
      h2.clock.now,
    );
    await subscribe(h2, user2);
    expect(await h2.stores.optOuts.suppressionFor(SUB)).toBe('BLOCKED');
    await h2.app.close();
  });

  it('stores a notification for an unknown subscriber but unlocks nothing', async () => {
    const h = await harness();
    await h.callback('subscription/notify', notify('REGISTERED', 'tel:nobody'));
    await settle(h);
    const row = await h.stores.subscriptions.get('tel:nobody');
    expect(row).toMatchObject({ status: 'REGISTERED', userId: null, plan: null });
    await h.app.close();
  });

  it('handles a redelivered notification once and never sees the API key it carries', async () => {
    const h = await harness();
    await h.addUser();
    const spy = vi.spyOn(h.stores.subscriptions, 'upsert');
    await h.callback('subscription/notify', notify('REGISTERED'));
    await h.callback('subscription/notify', notify('REGISTERED'));
    await settle(h);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-API-KEY');
    await h.app.close();
  });

  it('opt-out from the app ends the subscription and stops every message', async () => {
    const h = await harness();
    const user = await h.addUser();
    for (const scope of ['SMS', 'SUBSCRIPTION', 'ALL']) {
      const res = await h.api(user, 'POST', '/account/opt-out', { scope });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
    }
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    await settle(h);
    expect(h.applink.unregister).toHaveBeenCalledWith(SUB);
    expect((await h.api(user, 'POST', '/account/opt-out', { scope: 'NOPE' })).statusCode).toBe(400);
    await h.app.close();
  });
});

describe('entitlements and quotas', () => {
  it('free scans stop at the monthly limit and then point to pay-per-use', async () => {
    const h = await harness();
    const user = await h.addUser();
    const limit = 5; // DEFAULT_BILLING.limits.free.scans
    for (let i = 0; i < limit; i++) {
      expect(await h.app.services.entitlements.useScan(user.id)).toEqual({
        allowed: true,
        via: 'QUOTA',
      });
    }
    const denied = await h.app.services.entitlements.useScan(user.id);
    expect(denied).toEqual({
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      payWith: { purpose: 'SCAN', amount: '5.00', currency: 'BDT' },
    });
    const view = (await h.api(user, 'GET', '/billing/entitlements')).json();
    expect(view).toMatchObject({ tier: 'FREE', scans: { used: 5, limit: 5 } });
    await h.app.close();
  });

  it('a paid credit covers a scan over the limit', async () => {
    const h = await harness();
    const user = await h.addUser();
    for (let i = 0; i < 5; i++) await h.app.services.entitlements.useScan(user.id);
    const charge = await h.stores.charges.create(
      {
        externalTrxId: 'trx-1',
        userId: user.id,
        subscriberId: SUB,
        purpose: 'SCAN',
        amount: '5.00',
        currency: 'BDT',
      },
      h.clock.now,
    );
    await h.stores.entitlements.grant(
      { userId: user.id, feature: 'SCAN', quantity: 1, chargeId: charge.externalTrxId },
      h.clock.now,
    );
    expect(await h.app.services.entitlements.useScan(user.id)).toEqual({
      allowed: true,
      via: 'CREDIT',
    });
    expect((await h.app.services.entitlements.useScan(user.id)).allowed).toBe(false);
    await h.app.close();
  });

  it('Premium has bigger allowances and includes doctor summaries', async () => {
    const h = await harness({ applink: registering() });
    const user = await h.addUser();
    expect(await h.app.services.entitlements.useFeature(user.id, 'DOCTOR_SUMMARY')).toMatchObject({
      allowed: false,
      payWith: { purpose: 'DOCTOR_SUMMARY', amount: '2.00' },
    });

    await subscribe(h, user);
    expect(await h.app.services.entitlements.useFeature(user.id, 'DOCTOR_SUMMARY')).toEqual({
      allowed: true,
      via: 'PREMIUM',
    });
    const view = (await h.api(user, 'GET', '/billing/entitlements')).json();
    expect(view.tier).toBe('PREMIUM');
    expect(view.scans.limit).toBe(100);
    expect(view.features).toContain('CAREGIVER_ESCALATION');
    await h.app.close();
  });

  it('reminder SMS count against the monthly cap, atomically', async () => {
    const h = await harness();
    const user = await h.addUser();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => h.app.services.entitlements.useSms(user.id)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(30); // free cap
    await h.app.close();
  });

  it('counters roll over at the start of the month in Bangladesh time', async () => {
    const h = await harness();
    const user = await h.addUser();
    for (let i = 0; i < 5; i++) await h.app.services.entitlements.useScan(user.id);
    expect((await h.app.services.entitlements.useScan(user.id)).allowed).toBe(false);
    // 18:30 UTC on the 30th is already December 1st in Dhaka (UTC+6).
    h.clock.now = new Date('2026-11-30T18:30:00Z');
    expect((await h.app.services.entitlements.useScan(user.id)).allowed).toBe(true);
    await h.app.close();
  });

  it('the entitlements response matches the shared contract', async () => {
    const h = await harness();
    const user = await h.addUser();
    const res = await h.api(user, 'GET', '/billing/entitlements');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tier: 'FREE',
      scans: { used: 0, limit: 5 },
      sms: { used: 0, limit: 30 },
      doctorSummaryCredits: 0,
    });
    await h.app.close();
  });
});
