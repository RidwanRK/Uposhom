import { describe, expect, it, vi } from 'vitest';
import { ApplinkTransportError } from '@uposhom/applink-client';
import { subscriptionStatusResponse } from '@uposhom/shared';
import { applinkError, fakeApplink, harness, ok, OTHER, settle, SUB } from './platform.js';

const WORDING = 'I agree to pay 30 BDT every month. Renews automatically. Cancel any time.';
const CODE = '12345';
type H = Awaited<ReturnType<typeof harness>>;
type User = Parameters<H['api']>[0];

/** Step 1 of Pro: the ticked consent, then Applink sends the OTP. */
const requestCode = (h: H, user: User, payload: object = consent()) =>
  h.api(user, 'POST', '/billing/subscription/otp/request', payload);
/** Step 2: the code the person received. */
const verifyCode = (h: H, user: User, otp = CODE) =>
  h.api(user, 'POST', '/billing/subscription/otp/verify', { otp });
/** Both steps, the way the app does them. Returns the verify answer (or the failed request). */
const subscribe = async (h: H, user: User) => {
  const sent = await requestCode(h, user);
  return sent.statusCode === 200 ? verifyCode(h, user) : sent;
};
const consent = () => ({ consentAccepted: true, consentWording: WORDING });

const notify = (status: string, subscriberId = SUB, timeStamp = '20261122100000') => ({
  timeStamp,
  version: '1.0',
  applicationId: 'APP_1',
  password: 'SECRET-API-KEY',
  subscriberId,
  frequency: 'monthly',
  status,
});

/**
 * Applink as the Pro flow sees it: the OTP is sent, then verify answers with the subscription
 * status. `lookup` is what getSubscriberChargingInfo says afterwards. `register` is what the
 * subscription call answers (or the error it throws); the flow only makes it when verify says
 * INITIAL.
 */
const otpApplink = (
  status = 'REGISTERED',
  opts: { lookup?: string; subscriberId?: string; register?: string | Error } = {},
) => {
  const { lookup = status, subscriberId = SUB, register = 'REGISTERED' } = opts;
  return fakeApplink({
    requestOtp: async () => ok({ referenceNo: 'ref-1' }),
    verifyOtp: async () => ok({ subscriberId, subscriptionStatus: status }),
    getSubscriberChargingInfo: async () =>
      ok({ subscriberInfo: [{ subscriberId, subscriptionStatus: lookup, statusCode: 'S1000' }] }),
    register: async () => {
      if (register instanceof Error) throw register;
      return ok({ subscriptionStatus: register });
    },
  });
};

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
    // Consent exists, status is active, but the person never verified the plan's OTP.
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    await h.app.close();
  });

  it('subscribes with the OTP API: consent first, then the code is sent, then verify activates', async () => {
    const order: string[] = [];
    const applink = fakeApplink({
      requestOtp: async () => {
        order.push('otp-request');
        return ok({ referenceNo: 'ref-1' });
      },
      verifyOtp: async () => {
        order.push('otp-verify');
        return ok({ subscriberId: SUB, subscriptionStatus: 'REGISTERED' });
      },
      register: async () => ok({ subscriptionStatus: 'REGISTERED' }),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const record = h.stores.consents.record.bind(h.stores.consents);
    h.stores.consents.record = async (input, now) => {
      order.push('consent');
      return record(input, now);
    };

    const sent = await requestCode(h, user);
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ success: true, expiresInSeconds: 300 });
    // Not Premium until the code is verified.
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);

    const res = await verifyCode(h, user);
    expect(order).toEqual(['consent', 'otp-request', 'otp-verify']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      status: 'ACTIVE',
      plan: 'FAMILY_CIRCLE',
      amount: '30.00',
      currency: 'BDT',
    });
    expect(subscriptionStatusResponse.safeParse(body).success).toBe(true);
    expect(applink.requestOtp).toHaveBeenCalledWith({ subscriberId: '8801959979376' });
    expect(applink.verifyOtp).toHaveBeenCalledWith({ referenceNo: 'ref-1', otp: CODE });
    // The documented flow has no separate Register step.
    expect(applink.register).not.toHaveBeenCalled();
    expect((await h.stores.subscriptions.get(SUB))?.confirmedBy).toBe('OTP_VERIFY');

    expect(await h.app.services.subscriptions.isPremium(user)).toBe(true);
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('stores the consent evidence: wording, amount, currency, frequency, channel and IP', async () => {
    const h = await harness({ applink: otpApplink() });
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

  it('refuses without consent and never sends a code', async () => {
    const h = await harness({ applink: otpApplink() });
    const user = await h.addUser();
    for (const payload of [
      {},
      { consentAccepted: false, consentWording: WORDING },
      { consentAccepted: true },
    ]) {
      const res = await requestCode(h, user, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CONSENT_REQUIRED');
    }
    expect(h.applink.requestOtp).not.toHaveBeenCalled();
    expect(h.applink.verifyOtp).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('a code that was never requested cannot activate anything', async () => {
    const h = await harness({ applink: otpApplink() });
    const user = await h.addUser();
    const res = await verifyCode(h, user);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('OTP_EXPIRED');
    expect(h.applink.verifyOtp).not.toHaveBeenCalled();
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    await h.app.close();
  });

  it('refuses a malformed code before Applink is asked', async () => {
    const h = await harness({ applink: otpApplink() });
    const user = await h.addUser();
    await requestCode(h, user);
    for (const otp of ['abc', '1234', '123456', '']) {
      expect((await verifyCode(h, user, otp)).statusCode).toBe(400);
    }
    expect(h.applink.verifyOtp).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('a wrong code does not activate, and the right one still can', async () => {
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: vi
        .fn()
        .mockRejectedValueOnce(applinkError('E1850'))
        .mockResolvedValue(ok({ subscriberId: SUB, subscriptionStatus: 'REGISTERED' })),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    await requestCode(h, user);

    const wrong = await verifyCode(h, user, '00000');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('OTP_WRONG');
    expect(wrong.body).not.toContain('E1850');
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);

    expect((await verifyCode(h, user)).json().status).toBe('ACTIVE');
    await h.app.close();
  });

  it('a code for another number cannot activate this account', async () => {
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: async () => ok({ subscriberId: OTHER, subscriptionStatus: 'REGISTERED' }),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    await requestCode(h, user);
    const res = await verifyCode(h, user);
    expect(res.statusCode).toBe(401);
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    await h.app.close();
  });

  it('REG_PENDING waits for the notification, which then activates it', async () => {
    const h = await harness({ applink: otpApplink('REG_PENDING') });
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
    const h = await harness({ applink: otpApplink('REGISTERED', { subscriberId: 'tel:pharm-1' }) });
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
        requestOtp: async () => {
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

  it('an expired code is reported as expired', async () => {
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: async () => {
        throw applinkError('E1851');
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    await requestCode(h, user);
    const res = await verifyCode(h, user);
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('OTP_EXPIRED');
    await h.app.close();
  });

  it('INITIAL after the code: Register is called once and activates the plan', async () => {
    const h = await harness({ applink: otpApplink('INITIAL', { register: 'REGISTERED' }) });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.json().status).toBe('ACTIVE');
    expect(h.applink.register).toHaveBeenCalledTimes(1);
    expect(h.applink.register).toHaveBeenCalledWith(SUB);
    expect((await h.stores.subscriptions.get(SUB))?.confirmedBy).toBe('REGISTER_RESPONSE');
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(true);
    expect(h.applink.getSubscriberChargingInfo).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('REG_PENDING after the code never calls Register: its charging request is already out', async () => {
    const h = await harness({ applink: otpApplink('REG_PENDING') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.register).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('Register answering PENDING CONFIRMATION (E1338) keeps it pending, then one status lookup', async () => {
    const h = await harness({
      applink: otpApplink('INITIAL', { register: 'PENDING CONFIRMATION' }),
    });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    expect(h.applink.register).toHaveBeenCalledTimes(1);
    expect(h.applink.getSubscriberChargingInfo).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('a Register failure after a good code is not the person’s failure: still pending, not an error', async () => {
    const h = await harness({
      applink: otpApplink('INITIAL', { register: applinkError('E1603') }),
    });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    await h.app.close();
  });

  it('a Register timeout stays pending and is never retried, because it may have gone through', async () => {
    const timeout = new ApplinkTransportError('timed out', 'subscription-register');
    const h = await harness({ applink: otpApplink('INITIAL', { register: timeout }) });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.register).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('a billing block on Register is a failure, and Premium stays shut', async () => {
    const h = await harness({ applink: otpApplink('INITIAL', { register: 'TEMPORARY_BLOCKED' }) });
    const user = await h.addUser();
    expect((await subscribe(h, user)).statusCode).toBe(503);
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    await h.app.close();
  });

  it('INITIAL stays pending until Applink says REGISTERED, here through the notification', async () => {
    const h = await harness({
      applink: otpApplink('INITIAL', { register: 'PENDING CONFIRMATION' }),
    });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    expect((await h.stores.subscriptions.get(SUB))?.registerRequestedAt).not.toBeNull();
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('FREE');

    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100500'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe('ACTIVE');
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('PENDING CONFIRMATION is pending too, then active on the notification', async () => {
    const h = await harness({ applink: otpApplink('PENDING CONFIRMATION') });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');

    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100500'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().tier).toBe('PREMIUM');
    await h.app.close();
  });

  it('a pending answer is settled at once when Applink’s status lookup already says REGISTERED', async () => {
    const h = await harness({
      applink: otpApplink('INITIAL', { lookup: 'REGISTERED', register: 'PENDING CONFIRMATION' }),
    });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.json().status).toBe('ACTIVE');
    expect(h.applink.getSubscriberChargingInfo).toHaveBeenCalledWith([SUB]);
    expect((await h.stores.subscriptions.get(SUB))?.confirmedBy).toBe('SWEEP');
    await h.app.close();
  });

  it('an UNREGISTERED lookup right after verify is not applied and never opts anyone out', async () => {
    const h = await harness({
      applink: otpApplink('INITIAL', { lookup: 'UNREGISTERED', register: 'PENDING CONFIRMATION' }),
    });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.json().status).toBe('PENDING');
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
    await h.app.close();
  });

  it('a failing status lookup leaves it pending for the notification or the sweep', async () => {
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: async () => ok({ subscriberId: SUB, subscriptionStatus: 'INITIAL' }),
      register: async () => ok({ subscriptionStatus: 'PENDING CONFIRMATION' }),
      getSubscriberChargingInfo: async () => {
        throw applinkError('E1603');
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const res = await subscribe(h, user);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING');
    await h.app.close();
  });

  it('keeps PENDING when intermediate INITIAL or REG_PENDING notifications arrive', async () => {
    const h = await harness({ applink: otpApplink('INITIAL', { register: 'INITIAL' }) });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');

    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.callback('subscription/notify', notify('REG_PENDING', SUB, '20261122100100'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'PENDING',
    );

    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100200'));
    await settle(h);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe('ACTIVE');
    await h.app.close();
  });

  it('does not overwrite an in-flight REGISTERED notification with a stale INITIAL answer', async () => {
    let resolveVerify!: (
      v: ReturnType<typeof ok<{ subscriberId: string; subscriptionStatus: string }>>,
    ) => void;
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: () =>
        new Promise((resolve) => {
          resolveVerify = resolve;
        }),
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    await requestCode(h, user);
    const pending = verifyCode(h, user);

    await vi.waitFor(() => expect(applink.verifyOtp).toHaveBeenCalledTimes(1));
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    await h.callback('subscription/notify', notify('REGISTERED', SUB, '20261122100001'));
    await settle(h);

    resolveVerify(ok({ subscriberId: SUB, subscriptionStatus: 'INITIAL' }));
    const res = await pending;
    expect(res.json().status).toBe('ACTIVE');
    expect((await h.stores.subscriptions.get(SUB))?.status).toBe('REGISTERED');
    await h.app.close();
  });

  it('an unconfirmed request lapses after Applink’s 60 minutes, and the person can ask again', async () => {
    const h = await harness({ applink: otpApplink('INITIAL', { register: 'INITIAL' }) });
    const user = await h.addUser();
    expect((await subscribe(h, user)).json().status).toBe('PENDING');

    h.clock.now = new Date(h.clock.now.getTime() + 61 * 60_000);
    // Never confirmed: back to the plan screen, not "cancelled", and never active.
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).toBe(
      'INACTIVE',
    );
    expect((await subscribe(h, user)).json().status).toBe('PENDING');
    expect(h.applink.requestOtp).toHaveBeenCalledTimes(2);
    await h.app.close();
  });

  it('a billing block on verify is a failure, and Premium stays shut', async () => {
    const h = await harness({ applink: otpApplink('TEMPORARY_BLOCKED') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).statusCode).toBe(503);
    expect((await h.api(user, 'GET', '/billing/subscription/status')).json().status).not.toBe(
      'ACTIVE',
    );
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    await h.app.close();
  });

  it('an unexpected status on verify is a failure and unlocks nothing', async () => {
    const h = await harness({ applink: otpApplink('UNREGISTERED.') });
    const user = await h.addUser();
    expect((await subscribe(h, user)).statusCode).toBe(503);
    expect(await h.app.services.subscriptions.isPremium(user)).toBe(false);
    await h.app.close();
  });

  it('a failed verify never makes a number REGISTERED at sign-up look Premium', async () => {
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'ref-1' }),
      verifyOtp: async () => {
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

  it('a fresh code lets a person who said STOP subscribe again', async () => {
    const h = await harness({ applink: otpApplink() });
    const user = await h.addUser();
    await h.stores.optOuts.suppress(
      { subscriberId: SUB, reason: 'STOP', source: 'SMS' },
      h.clock.now,
    );
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    expect((await subscribe(h, user)).json().status).toBe('ACTIVE');
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
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
      ['POST', '/api/v1/billing/subscription/otp/request'],
      ['POST', '/api/v1/billing/subscription/otp/verify'],
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
