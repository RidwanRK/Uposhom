import { describe, expect, it, vi } from 'vitest';
import { createTokenService } from '../src/auth/tokens.js';
import { fakeApplink, harness, ok, settle, SUB } from './platform.js';

type H = Awaited<ReturnType<typeof harness>>;
type U = Parameters<H['api']>[0];

/** The headers the app sends to delete an account: its access token and a fresh step-up token. */
async function withStepUp(h: H, user: U) {
  const stepUpToken = await createTokenService('x'.repeat(40)).signStepUp(user.id);
  return { ...(await h.bearer(user)), 'x-step-up-token': stepUpToken };
}

const del = (h: H, headers?: Record<string, string>) =>
  h.app.inject({ method: 'DELETE', url: '/api/v1/account', ...(headers ? { headers } : {}) });

/** An Applink where a one-off charge can be started and submitted. */
const charging = () =>
  fakeApplink({
    startCharge: async (input: { externalTrxId: string }) => ({
      statusCode: 'P1003',
      externalTrxId: input.externalTrxId,
      requestCorrelator: 'c',
      internalTrxId: 'int-1',
    }),
    confirmCharge: async () => ok({}),
  });

const startCharge = async (h: H, user: U) =>
  (
    await h.api(user, 'POST', '/billing/caas/initiate', {
      purpose: 'DOCTOR_SUMMARY',
      consentWording: 'Charge 5 BDT.',
    })
  ).json().chargeId as string;

describe('delete my data', () => {
  it('needs a signed-in user and a step-up token, and deletes nothing without them', async () => {
    const h = await harness();
    const user = await h.addUser();
    expect((await del(h)).statusCode).toBe(401);

    const withoutStepUp = await del(h, await h.bearer(user));
    expect(withoutStepUp.statusCode).toBe(403);
    expect(withoutStepUp.json().error.code).toBe('STEP_UP_REQUIRED');
    expect(await h.stores.users.findById(user.id)).not.toBeNull();
    await h.app.close();
  });

  it('erases the account, keeps the STOP entry, ends the Applink subscription, anonymises charges', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const bearer = await h.bearer(user);

    const chargeId = await startCharge(h, user);
    await h.stores.subscriptions.upsert(
      { subscriberId: SUB, userId: user.id, status: 'REGISTERED' },
      h.clock.now,
    );
    await h.app.services.sms.enqueue({
      subscriberId: SUB,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'p1',
    });
    await settle(h);

    const res = await del(h, await withStepUp(h, user));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    await settle(h);

    expect(await h.stores.users.findById(user.id)).toBeNull();
    expect(await h.stores.subscriptions.get(SUB)).toBeNull(); // not resurrected by the Unregister job
    expect(await h.stores.smsLog.findByIdempotencyKey('p1')).toBeNull();
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP'); // never messaged again
    expect(h.applink.unregister).toHaveBeenCalledWith(SUB);
    expect(await h.stores.charges.get(chargeId)).toMatchObject({
      userId: null,
      subscriberId: 'erased',
      amount: '2.00',
    });
    expect(await h.deadLetterCount()).toBe(0);

    // The old access token no longer opens anything.
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/billing/entitlements',
      headers: bearer,
    });
    expect(after.statusCode).toBe(401);
    await h.app.close();
  });

  it('erases the domain layer first, because its rows refer to the user', async () => {
    const order: string[] = [];
    const eraseDomainData = vi.fn(async () => void order.push('domain'));
    const h = await harness({ ports: { eraseDomainData } });
    const user = await h.addUser();
    const erase = h.stores.users.erase.bind(h.stores.users);
    h.stores.users.erase = async (id) => {
      order.push('applink-side');
      return erase(id);
    };
    await del(h, await withStepUp(h, user));
    expect(order).toEqual(['domain', 'applink-side']);
    expect(eraseDomainData).toHaveBeenCalledWith(user.id);
    await h.app.close();
  });

  it('a charge that settles after its owner erased their account is recorded and grants nothing', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await startCharge(h, user);
    await h.api(user, 'POST', '/billing/caas/verify', { chargeId, otp: '931204' });
    await del(h, await withStepUp(h, user));

    await h.callback('caas/charging-notification', {
      externalTrxId: chargeId,
      statusCode: 'S1000',
      paidAmount: '5.00',
      balanceDue: '0',
    });
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe('SETTLED'); // the money did move
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });
});
