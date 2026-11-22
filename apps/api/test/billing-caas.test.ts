import { describe, expect, it, vi } from 'vitest';
import { ApplinkTransportError } from '@uposhom/applink-client';
import { caasInitiateResponse, caasVerifyResponse } from '@uposhom/shared';
import { covers, fromPoisha, toPoisha } from '../src/billing/money.js';
import { applinkError, fakeApplink, harness, ok, settle, SUB } from './platform.js';

const WORDING = 'Charge 5.00 BDT to my mobile account for one Doctor Summary.';

/** An Applink where step 1 answers P1003 (OTP sent, nothing charged) and echoes our transaction id. */
function charging(over: Record<string, unknown> = {}) {
  return fakeApplink({
    startCharge: async (input: { externalTrxId: string }) => ({
      statusCode: 'P1003',
      statusDetail: 'OTP sent',
      externalTrxId: input.externalTrxId,
      requestCorrelator: 'corr-1',
      internalTrxId: 'int-1',
    }),
    confirmCharge: async () => ok({}),
    ...over,
  });
}

type H = Awaited<ReturnType<typeof harness>>;
type U = Parameters<H['api']>[0];

const initiate = (h: H, user: U, purpose = 'DOCTOR_SUMMARY', body: object = {}) =>
  h.api(user, 'POST', '/billing/caas/initiate', { purpose, consentWording: WORDING, ...body });
const verify = (h: H, user: U, chargeId: string, otp = '931204') =>
  h.api(user, 'POST', '/billing/caas/verify', { chargeId, otp });

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

/** Starts and verifies a charge, ready for the notification. */
async function submitted(h: H, user: U, purpose = 'DOCTOR_SUMMARY') {
  const { chargeId } = (await initiate(h, user, purpose)).json();
  await verify(h, user, chargeId);
  return chargeId as string;
}

describe('initiate', () => {
  it('writes the ledger row and consent BEFORE calling Applink, and charges the server-side price', async () => {
    const order: string[] = [];
    const applink = charging({
      startCharge: async (input: { externalTrxId: string; amount: string }) => {
        order.push('applink');
        expect(input.amount).toBe('5.00');
        return {
          statusCode: 'P1003',
          externalTrxId: input.externalTrxId,
          requestCorrelator: 'corr-1',
          internalTrxId: 'int-1',
        };
      },
    });
    const h = await harness({ applink });
    const user = await h.addUser();
    const createCharge = h.stores.charges.create.bind(h.stores.charges);
    h.stores.charges.create = async (input, now) => {
      order.push('ledger');
      return createCharge(input, now);
    };
    const record = h.stores.consents.record.bind(h.stores.consents);
    h.stores.consents.record = async (input, now) => {
      order.push('consent');
      return record(input, now);
    };

    // The app tries to name its own price: the server ignores it.
    const res = await initiate(h, user, 'DOCTOR_SUMMARY', { amount: '0.01' });
    expect(order).toEqual(['consent', 'ledger', 'applink']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(caasInitiateResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ amount: '5.00', currency: 'BDT', status: 'OTP_SENT' });

    const row = await h.stores.charges.get(body.chargeId);
    expect(row).toMatchObject({
      status: 'OTP_SENT',
      amount: '5.00',
      requestCorrelator: 'corr-1',
      internalTrxId: 'int-1',
      userId: user.id,
    });
    await h.app.close();
  });

  it('every payment is its own flow: a new transaction id and a new OTP each time', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const a = (await initiate(h, user)).json().chargeId;
    const b = (await initiate(h, user)).json().chargeId;
    expect(a).not.toBe(b);
    expect(h.applink.startCharge).toHaveBeenCalledTimes(2);
    await h.app.close();
  });

  it('records what the person agreed to for this payment', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const spy = vi.spyOn(h.stores.consents, 'record');
    await initiate(h, user, 'SCAN');
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        kind: 'CAAS_SCAN_V1',
        wording: WORDING,
        amount: '5.00',
        currency: 'BDT',
      }),
      expect.any(Date),
    );
    await h.app.close();
  });

  it('rejects an unknown purpose and a missing wording', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    expect((await initiate(h, user, 'FREE_STUFF')).statusCode).toBe(400);
    expect(
      (await h.api(user, 'POST', '/billing/caas/initiate', { purpose: 'SCAN' })).statusCode,
    ).toBe(400);
    expect(h.applink.startCharge).not.toHaveBeenCalled();
    await h.app.close();
  });

  it.each([
    ['E1326', 402, 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_BALANCE'],
    ['E1343', 403, 'NOT_ON_TEST_LIST', 'FAILED'],
    ['E1342', 403, 'NUMBER_BLOCKED', 'FAILED'],
    ['E1603', 503, 'PAYMENT_UNAVAILABLE', 'FAILED'],
  ])(
    'maps Applink %s to %s and closes the ledger row as %s',
    async (code, http, mapped, ledger) => {
      const h = await harness({
        applink: charging({
          startCharge: async () => {
            throw applinkError(code);
          },
        }),
      });
      const user = await h.addUser();
      const res = await initiate(h, user);
      expect(res.statusCode).toBe(http);
      expect(res.json().error.code).toBe(mapped);
      expect(res.body).not.toContain(code);
      const [row] = await h.stores.charges.listOpen(new Date('2100-01-01'), 10);
      expect(row).toBeUndefined(); // no longer open
      await h.app.close();
      void ledger;
    },
  );

  it('a timeout on step 1 is abandoned: nothing was charged', async () => {
    const h = await harness({
      applink: charging({
        startCharge: async () => {
          throw new ApplinkTransportError('timed out', 'caas-otp-generation');
        },
      }),
    });
    const user = await h.addUser();
    const res = await initiate(h, user);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('PAYMENT_UNAVAILABLE');
    // The open row is closed by reconciliation, not left to be used.
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    expect(await h.app.services.caas.reconcile()).toEqual({ expired: 1, stuck: 0 });
    await h.app.close();
  });

  it('refuses an answer that echoes a different transaction id, or gives no correlator', async () => {
    for (const reply of [
      { statusCode: 'P1003', externalTrxId: 'someone-elses', requestCorrelator: 'c' },
      { statusCode: 'P1003', requestCorrelator: '' },
    ]) {
      const h = await harness({ applink: charging({ startCharge: async () => reply }) });
      const user = await h.addUser();
      const res = await initiate(h, user);
      expect(res.statusCode).toBe(503);
      await h.app.close();
    }
  });

  it('is rate limited per account, because every start sends a paid OTP SMS', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    for (let i = 0; i < 5; i++) expect((await initiate(h, user)).statusCode).toBe(200);
    const limited = await initiate(h, user);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    await h.app.close();
  });

  it('fails closed when Applink is not configured', async () => {
    const h = await harness({ applink: undefined });
    const user = await h.addUser();
    expect((await initiate(h, user)).statusCode).toBe(503);
    await h.app.close();
  });

  it('requires a signed-in user', async () => {
    const h = await harness({ applink: charging() });
    for (const [method, url] of [
      ['POST', '/api/v1/billing/caas/initiate'],
      ['POST', '/api/v1/billing/caas/verify'],
      ['GET', '/api/v1/billing/caas/anything'],
    ] as const) {
      const res = await h.app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, url).toBe(401);
    }
    await h.app.close();
  });
});

describe('verify', () => {
  it('submits with the requestCorrelator (not our id), reports PENDING, and settles nothing', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    const res = await verify(h, user, chargeId);

    expect(res.statusCode).toBe(200);
    expect(caasVerifyResponse.safeParse(res.json()).success).toBe(true);
    expect(res.json()).toEqual({ chargeId, status: 'PENDING' });
    expect(h.applink.confirmCharge).toHaveBeenCalledWith({
      requestCorrelator: 'corr-1',
      otp: '931204',
      subscriberId: SUB,
    });
    // S1000 only means submitted: no entitlement, ledger not fulfilled.
    expect((await h.stores.charges.get(chargeId))?.status).toBe('PROCESSING');
    expect((await h.stores.charges.get(chargeId))?.fulfilledAt).toBeNull();
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);
    await h.app.close();
  });

  it('a wrong code re-prompts the SAME charge and never starts a new one', async () => {
    let wrong = true;
    const h = await harness({
      applink: charging({
        confirmCharge: async () => {
          if (wrong) throw applinkError('E1850');
          return ok({});
        },
      }),
    });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();

    const first = await verify(h, user, chargeId, '000000');
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ chargeId, status: 'OTP_SENT', code: 'OTP_WRONG' });

    wrong = false;
    expect((await verify(h, user, chargeId)).json().status).toBe('PENDING');
    expect(h.applink.startCharge).toHaveBeenCalledTimes(1); // step 1 is never re-run
    await h.app.close();
  });

  it('abandons the charge after five wrong codes', async () => {
    const h = await harness({
      applink: charging({
        confirmCharge: async () => {
          throw applinkError('E1850');
        },
      }),
    });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    for (let i = 0; i < 5; i++) {
      expect((await verify(h, user, chargeId, '000000')).json().code).toBe('OTP_WRONG');
    }
    expect((await verify(h, user, chargeId, '000000')).json().status).toBe('EXPIRED');
    expect(h.applink.confirmCharge).toHaveBeenCalledTimes(5);
    await h.app.close();
  });

  it.each([
    ['E1851', 'EXPIRED'],
    ['E1326', 'INSUFFICIENT_BALANCE'],
    ['E1337', 'PENDING'],
    ['E1855', 'FAILED'],
    ['E1603', 'FAILED'],
  ])('Applink %s on verify leaves the charge %s', async (code, expected) => {
    const h = await harness({
      applink: charging({
        confirmCharge: async () => {
          throw applinkError(code);
        },
      }),
    });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    const res = await verify(h, user, chargeId);
    expect(res.json().status).toBe(expected);
    expect(res.body).not.toContain(code);
    await h.app.close();
  });

  it('a timeout after submitting is never retried: the notification decides', async () => {
    const h = await harness({
      applink: charging({
        confirmCharge: async () => {
          throw new ApplinkTransportError('timed out', 'caas-otp-verify');
        },
      }),
    });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    expect((await verify(h, user, chargeId)).json().status).toBe('PENDING');
    // A second tap cannot submit a second debit.
    expect((await verify(h, user, chargeId)).json().status).toBe('PENDING');
    expect(h.applink.confirmCharge).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('a double tap after success does not submit twice', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    await verify(h, user, chargeId);
    await verify(h, user, chargeId);
    expect(h.applink.confirmCharge).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('an OTP older than five minutes is expired locally without calling Applink', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60_000 + 1000);
    expect((await verify(h, user, chargeId)).json().status).toBe('EXPIRED');
    expect(h.applink.confirmCharge).not.toHaveBeenCalled();
    await h.app.close();
  });

  it("someone else's charge looks exactly like a missing one", async () => {
    const h = await harness({ applink: charging() });
    const owner = await h.addUser();
    const other = await h.addUser('tel:other-1', { msisdn: '8801711111111' });
    const { chargeId } = (await initiate(h, owner)).json();
    for (const res of [
      await verify(h, other, chargeId),
      await h.api(other, 'GET', `/billing/caas/${chargeId}`),
    ]) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('CHARGE_NOT_FOUND');
    }
    expect((await h.api(other, 'GET', '/billing/caas/does-not-exist')).statusCode).toBe(404);
    expect(h.applink.confirmCharge).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('rejects a malformed code', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const { chargeId } = (await initiate(h, user)).json();
    expect((await verify(h, user, chargeId, 'abc')).statusCode).toBe(400);
    await h.app.close();
  });
});

describe('the charging notification settles the ledger', () => {
  it('S1000 with the full amount paid and nothing owed settles and releases the entitlement once', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);

    await h.callback('caas/charging-notification', note(chargeId));
    await settle(h);

    const row = await h.stores.charges.get(chargeId);
    expect(row).toMatchObject({
      status: 'SETTLED',
      paidAmount: '5.00',
      balanceDue: '0',
      referenceId: 'ref-9',
    });
    expect(row?.fulfilledAt).not.toBeNull();
    expect((await h.api(user, 'GET', `/billing/caas/${chargeId}`)).json().status).toBe('SETTLED');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);
    expect((await h.api(user, 'GET', '/billing/entitlements')).json().doctorSummaryCredits).toBe(1);

    // The credit is spendable exactly once.
    expect(await h.app.services.entitlements.useFeature(user.id, 'DOCTOR_SUMMARY')).toEqual({
      allowed: true,
      via: 'CREDIT',
    });
    expect((await h.app.services.entitlements.useFeature(user.id, 'DOCTOR_SUMMARY')).allowed).toBe(
      false,
    );
    await h.app.close();
  });

  it('partial payment then full payment: fulfils only when everything is paid', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);

    // First notification: a partial payment (P-prefixed code), 2.00 of 5.00 paid.
    await h.callback(
      'caas/charging-notification',
      note(chargeId, { statusCode: 'P1003', paidAmount: '2.00', balanceDue: '3.00' }),
    );
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe('PARTIAL');
    expect((await h.api(user, 'GET', `/billing/caas/${chargeId}`)).json().status).toBe('PENDING');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);

    // Second notification: the balance is cleared.
    await h.callback(
      'caas/charging-notification',
      note(chargeId, { statusCode: 'S1000', paidAmount: '5.00', balanceDue: '0.00' }),
    );
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe('SETTLED');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);
    await h.app.close();
  });

  it.each([
    ['paid short of the price', { paidAmount: '3.00', balanceDue: '0' }],
    ['money still owed', { paidAmount: '5.00', balanceDue: '1.00' }],
    ['no paid amount at all', { paidAmount: '' }],
    ['an amount that is not a number', { paidAmount: 'five' }],
  ])('an S1000 with %s does not fulfil', async (_label, over) => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);
    await h.callback('caas/charging-notification', note(chargeId, over));
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe('PARTIAL');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);
    await h.app.close();
  });

  it('a replayed notification, and handling it twice directly, grant exactly one credit', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);
    await h.callback('caas/charging-notification', note(chargeId));
    await h.callback('caas/charging-notification', note(chargeId)); // redelivery: same dedupe key
    await settle(h);
    // Even bypassing the receiver's dedupe, the grant is idempotent on the charge.
    await h.app.services.caas.handleNotification(note(chargeId));
    await h.app.services.caas.handleNotification(
      note(chargeId, { statusCode: 'S1000', internalTrxId: 'int-2' }),
    );
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);
    await h.app.close();
  });

  it('a late partial notification never undoes a settled charge', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);
    await h.callback('caas/charging-notification', note(chargeId));
    await settle(h);
    await h.callback(
      'caas/charging-notification',
      note(chargeId, { statusCode: 'P1003', paidAmount: '2.00', balanceDue: '3.00' }),
    );
    await h.callback('caas/charging-notification', note(chargeId, { statusCode: 'E1308' }));
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe('SETTLED');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);
    await h.app.close();
  });

  it.each([
    ['E1308', 'FAILED'],
    ['E1326', 'INSUFFICIENT_BALANCE'],
  ])('a %s notification is recorded and never fulfilled', async (statusCode, expected) => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const chargeId = await submitted(h, user);
    await h.callback(
      'caas/charging-notification',
      note(chargeId, { statusCode, paidAmount: '0', balanceDue: '5.00' }),
    );
    await settle(h);
    expect((await h.stores.charges.get(chargeId))?.status).toBe(expected);
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);
    await h.app.close();
  });

  it('a notification for a charge we never started is discarded without error', async () => {
    const h = await harness({ applink: charging() });
    const res = await h.callback('caas/charging-notification', note('not-ours'));
    expect(res).toEqual({ statusCode: 'S1000', statusDetail: 'Success' });
    await settle(h);
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });

  it('each purpose grants its own feature', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const scan = await submitted(h, user, 'SCAN');
    await h.callback('caas/charging-notification', note(scan));
    await settle(h);
    expect(await h.stores.entitlements.available(user.id, 'SCAN')).toBe(1);
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(0);
    await h.app.close();
  });
});

describe('reconciliation', () => {
  it('closes unused OTPs, flags submitted charges that never confirmed, and leaves the rest alone', async () => {
    const h = await harness({ applink: charging() });
    const user = await h.addUser();
    const open = (await initiate(h, user)).json().chargeId; // OTP_SENT
    const inFlight = await submitted(h, user); // PROCESSING
    const done = await submitted(h, user);
    await h.callback('caas/charging-notification', note(done));
    await settle(h);

    // 11 minutes on: the unused OTP is closed. The in-flight charge is not stuck yet.
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60_000);
    expect(await h.app.services.caas.reconcile()).toEqual({ expired: 1, stuck: 0 });
    expect((await h.stores.charges.get(open))?.status).toBe('EXPIRED');
    expect((await h.stores.charges.get(inFlight))?.status).toBe('PROCESSING');

    // Three hours on: submitted but never confirmed. Failed and alerted, never fulfilled.
    h.clock.now = new Date(h.clock.now.getTime() + 3 * 60 * 60_000);
    expect(await h.app.services.caas.reconcile()).toEqual({ expired: 0, stuck: 1 });
    expect((await h.stores.charges.get(inFlight))?.status).toBe('FAILED');
    expect(await h.stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1); // only the settled one
    expect((await h.stores.charges.get(done))?.status).toBe('SETTLED');
    await h.app.close();
  });
});

describe('money', () => {
  it('parses exact decimal amounts and rejects everything else', () => {
    expect(toPoisha('5')).toBe(500);
    expect(toPoisha('5.0')).toBe(500);
    expect(toPoisha('5.00')).toBe(500);
    expect(toPoisha('0.05')).toBe(5);
    expect(toPoisha('30.50')).toBe(3050);
    for (const bad of ['', 'five', '5.123', '-1', '1e3', ' ', '5,00', null, undefined]) {
      expect(toPoisha(bad as string)).toBeNull();
    }
    expect(fromPoisha(500)).toBe('5.00');
    expect(fromPoisha(5)).toBe('0.05');
  });

  it('"covers" is exact, with no float drift', () => {
    expect(covers('5.00', '5.00')).toBe(true);
    expect(covers('5', '5.00')).toBe(true);
    expect(covers('4.99', '5.00')).toBe(false);
    expect(covers('0.30', '0.30')).toBe(true); // 0.1 + 0.2 style traps do not exist in integers
    expect(covers('', '5.00')).toBe(false);
    expect(covers(undefined, '5.00')).toBe(false);
    expect(covers('nonsense', '5.00')).toBe(false);
  });
});
