import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, settle, SUB } from './platform.js';
import { startMockApplink, type MockApplink } from './helpers.js';

/**
 * Plan checkpoint: "CaaS two-step payment test passes end-to-end on the mock, releasing the Doctor
 * Summary entitlement, including a partial-then-full payment case". The real Applink client talks
 * to scripts/mock-applink.mjs, which checks every request body against the published contract.
 *
 * The mock answers with canned samples, so the echoed externalTrxId is patched to what real
 * Applink would echo back (the transaction id we sent).
 */
let mock: MockApplink;
beforeAll(async () => {
  mock = await startMockApplink(18093);
});
afterAll(() => mock.stop());

/** Fetch wrapper: echoes our externalTrxId on the debit answer, like the real platform. */
const echoingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (!String(input).endsWith('/caas/direct/debit')) return res;
  const sent = JSON.parse(String(init?.body ?? '{}')) as { externalTrxId?: string };
  const body = (await res.json()) as Record<string, unknown>;
  return new Response(JSON.stringify({ ...body, externalTrxId: sent.externalTrxId }), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
};

const note = (externalTrxId: string, over: Record<string, string> = {}) => ({
  timeStamp: '22-Nov-2026 11:55',
  TotalAmount: '5.00',
  externalTrxId,
  balanceDue: '0',
  statusDetail: 'Success',
  currency: 'BDT',
  version: '1.0',
  internalTrxId: 'int-1',
  paidAmount: '5.00',
  referenceId: 'ref-9',
  statusCode: 'S1000',
  ...over,
});

describe('CaaS and Subscription against the Applink mock', () => {
  it('pays for a doctor summary in two steps and settles from the notification', async () => {
    const h = await harness({ applink: mock.client('', echoingFetch) });
    const user = await h.addUser();

    const started = await h.api(user, 'POST', '/billing/caas/initiate', {
      purpose: 'DOCTOR_SUMMARY',
      consentWording: 'Charge 5.00 BDT for one Doctor Summary.',
    });
    expect(started.statusCode, started.body).toBe(200);
    const { chargeId } = started.json();

    const verified = await h.api(user, 'POST', '/billing/caas/verify', { chargeId, otp: '931204' });
    expect(verified.json().status).toBe('PENDING');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0); // not yet

    await h.callback('caas/charging-notification', note(chargeId));
    await settle(h);
    expect((await h.api(user, 'GET', `/billing/caas/${chargeId}`)).json().status).toBe('SETTLED');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);

    expect(await mock.badRequests()).toEqual([]);
    await h.app.close();
  });

  it('partial payment then full payment releases the entitlement only at the end', async () => {
    const h = await harness({ applink: mock.client('', echoingFetch) });
    const user = await h.addUser();
    const { chargeId } = (
      await h.api(user, 'POST', '/billing/caas/initiate', {
        purpose: 'DOCTOR_SUMMARY',
        consentWording: 'Charge 5.00 BDT.',
      })
    ).json();
    await h.api(user, 'POST', '/billing/caas/verify', { chargeId, otp: '931204' });

    await h.callback(
      'caas/charging-notification',
      note(chargeId, { statusCode: 'P1003', paidAmount: '2.00', balanceDue: '3.00' }),
    );
    await settle(h);
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);

    await h.callback(
      'caas/charging-notification',
      note(chargeId, { paidAmount: '5.00', balanceDue: '0.00' }),
    );
    await settle(h);
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);
    expect(await mock.badRequests()).toEqual([]);
    await h.app.close();
  });

  it('subscribes and cancels with request bodies the contract accepts', async () => {
    const h = await harness({ applink: mock.client('') });
    const user = await h.addUser();
    const sub = await h.api(user, 'POST', '/billing/subscription/subscribe', {
      consentAccepted: true,
      consentWording: 'Pay 30 BDT monthly.',
    });
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json().status).toBe('ACTIVE'); // the mock's Register sample answers REGISTERED

    await h.api(user, 'POST', '/billing/subscription/unsubscribe');
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    expect((await h.stores.subscriptions.get(SUB))?.status).toBe('UNREGISTERED');
    expect(await mock.badRequests()).toEqual([]);
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });
});
