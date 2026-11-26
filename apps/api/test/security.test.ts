import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createIpLimiter, redactCallbackKey } from '../src/ops/http-safety.js';
import { fakeApplink, harness, ok, settle } from './platform.js';

// Generated per run, so the repository never contains a key-shaped literal for a secret scanner
// to flag (and the test cannot pass by accident because of a value somebody memorised).
const KEY = `k3y-${randomBytes(16).toString('hex')}`;
const ACK = { statusCode: 'S1000', statusDetail: 'Success' };

/** Collects everything the server logs. */
function capture() {
  const lines: string[] = [];
  return {
    lines,
    stream: { write: (chunk: string) => void lines.push(chunk) },
    text: () => lines.join(''),
  };
}

describe('callback key stays secret', () => {
  it('redacts the key from URLs', () => {
    expect(redactCallbackKey(`/api/applink/${KEY}/sms/receive`, KEY)).toBe(
      '/api/applink/[redacted]/sms/receive',
    );
    expect(redactCallbackKey(`/api/applink/${KEY}/sms/receive?a=1`, KEY)).toBe(
      '/api/applink/[redacted]/sms/receive?a=1',
    );
    expect(redactCallbackKey('/healthz', KEY)).toBe('/healthz');
    expect(redactCallbackKey('/api/applink/sms/receive', undefined)).toBe(
      '/api/applink/sms/receive',
    );
  });

  it('never appears in a log line: not on success, not on a wrong method, not on a 404', async () => {
    const log = capture();
    const h = await harness({ callbackKey: KEY, logStream: log.stream });
    const body = { sourceAddress: 'tel:8801000000000', message: 'hi', requestId: 'r1' };
    await h.app.inject({ method: 'POST', url: `/api/applink/${KEY}/sms/receive`, payload: body });
    await h.app.inject({ method: 'GET', url: `/api/applink/${KEY}/sms/receive` }); // wrong method: 404
    await h.app.inject({ method: 'POST', url: `/api/applink/${KEY}/nope`, payload: {} }); // unknown path
    await h.app.inject({
      method: 'POST',
      url: `/api/applink/wrong-key/sms/receive`,
      payload: body,
    });
    await settle(h);

    expect(log.text()).toContain('/api/applink/[redacted]/sms/receive');
    expect(log.text()).not.toContain(KEY);
    await h.app.close();
  });

  it('a wrong key and a missing route answer a plain JSON 404 that names nothing', async () => {
    const h = await harness({ callbackKey: KEY });
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/applink/wrong/sms/receive',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ success: false, error: { code: 'NOT_FOUND' } });
    await h.app.close();
  });
});

describe('callbacks are always acknowledged', () => {
  it('an oversized body, a wrong content type and malformed JSON all get S1000 and enqueue nothing', async () => {
    const h = await harness();
    const url = '/api/applink/sms/receive';
    const huge = JSON.stringify({
      sourceAddress: 'tel:8801000000000',
      message: 'x'.repeat(40_000),
      requestId: 'big',
    });
    const cases: [string, string, string][] = [
      ['oversized', 'application/json', huge],
      ['text/plain', 'text/plain', 'hello'],
      ['form', 'application/x-www-form-urlencoded', 'a=1&b=2'],
      ['malformed', 'application/json', '{nope'],
      ['empty', 'application/json', ''],
    ];
    for (const [label, contentType, payload] of cases) {
      const res = await h.app.inject({
        method: 'POST',
        url,
        headers: { 'content-type': contentType },
        payload,
      });
      expect(res.statusCode, label).toBe(200);
      expect(res.json(), label).toEqual(ACK);
    }
    await settle(h);
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });
});

describe('HTTP safety', () => {
  it('API responses are never cached and never sniffed', async () => {
    const h = await harness();
    const api = await h.app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: {} });
    expect(api.headers['cache-control']).toBe('no-store');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    const health = await h.app.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    await h.app.close();
  });

  it('limits one client to 300 API requests a minute, but never the health probe or callbacks', async () => {
    const h = await harness();
    let allowed = 0;
    let limited: Awaited<ReturnType<typeof h.app.inject>> | undefined;
    for (let i = 0; i < 305; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: {},
        remoteAddress: '10.1.1.1',
      });
      if (res.statusCode === 200) allowed++;
      else limited ??= res;
    }
    expect(allowed).toBe(300);
    expect(limited?.statusCode).toBe(429);
    expect(limited?.headers['retry-after']).toBe('60');
    expect(limited?.json().error.code).toBe('RATE_LIMITED');

    // Same client: the health probe and the Applink callbacks are exempt.
    expect(
      (await h.app.inject({ method: 'GET', url: '/healthz', remoteAddress: '10.1.1.1' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/applink/sms/receive',
          payload: {},
          remoteAddress: '10.1.1.1',
        })
      ).statusCode,
    ).toBe(200);
    // Another client is unaffected.
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/logout',
          payload: {},
          remoteAddress: '10.2.2.2',
        })
      ).statusCode,
    ).toBe(200);
    await h.app.close();
  });

  it('the limiter slides and forgets idle clients', () => {
    let t = 0;
    const l = createIpLimiter(2, 1000, () => t);
    expect([l.hit('a'), l.hit('a'), l.hit('a')]).toEqual([true, true, false]);
    t = 1001;
    expect(l.hit('a')).toBe(true);
  });
});

describe('PII and secrets never reach the logs', () => {
  it('survives a whole product flow without leaking a number, code, token, password or message', async () => {
    const log = capture();
    const MSISDN_LOCAL = '01959979376';
    const MSISDN_INTL = '8801959979376';
    const SUBSCRIBER = 'tel:8801959979376';
    const OTP = '48291';
    const REF = 'REFNO-SECRET-7731';
    const CORR = 'CORR-SECRET-5520';
    const PASSWORD = 'APPLINK-PASSWORD-SECRET-9911';
    const MESSAGE = 'my private symptom text 7741';

    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: REF }),
      verifyOtp: async () => ok({ subscriberId: SUBSCRIBER, subscriptionStatus: 'REGISTERED' }),
      register: async () => ok({ subscriptionStatus: 'REGISTERED' }),
      startCharge: async (input: { externalTrxId: string }) => ({
        statusCode: 'P1003',
        statusDetail: 'OTP sent',
        externalTrxId: input.externalTrxId,
        requestCorrelator: CORR,
        internalTrxId: 'int-1',
      }),
      confirmCharge: async () => ok({}),
    });
    const h = await harness({ applink, callbackKey: KEY, logStream: log.stream });
    const json = (res: { json: () => unknown }) => res.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    // Sign-up, step-up, subscribe, pay, and the callbacks that follow.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { msisdn: MSISDN_LOCAL },
    });
    const verified = json(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/otp/verify',
        payload: { msisdn: MSISDN_LOCAL, otp: OTP },
      }),
    );
    const bearer = { authorization: `Bearer ${verified['token']}` };
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/step-up/request',
      headers: bearer,
      payload: {},
    });
    const stepUp = json(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/step-up/verify',
        headers: bearer,
        payload: { otp: OTP },
      }),
    );
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscription/subscribe',
      headers: { ...bearer, 'x-step-up-token': String(stepUp['stepUpToken']) },
      payload: { consentAccepted: true, consentWording: 'Pay 30 BDT monthly.' },
    });
    const started = json(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/billing/caas/initiate',
        headers: bearer,
        payload: { purpose: 'DOCTOR_SUMMARY', consentWording: 'Charge 5 BDT.' },
      }),
    );
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/billing/caas/verify',
      headers: bearer,
      payload: { chargeId: started['chargeId'], otp: OTP },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: verified['refreshToken'] },
    });

    const cb = (path: string, payload: object) => h.callback(path, payload);
    await cb('sms/receive', { sourceAddress: SUBSCRIBER, message: MESSAGE, requestId: 'mo-1' });
    await cb('sms/receive', {
      sourceAddress: 'tel:8801700000000',
      message: MESSAGE,
      requestId: 'mo-2',
    });
    await cb('sms/receive', { sourceAddress: SUBSCRIBER, message: 'STOP', requestId: 'mo-3' });
    await cb('sms/report', {
      destinationAddress: SUBSCRIBER,
      requestId: 'nobody',
      deliveryStatus: 'DELIVERED',
    });
    await cb('subscription/notify', {
      timeStamp: '20261122100000',
      subscriberId: SUBSCRIBER,
      status: 'REGISTERED',
      password: PASSWORD,
      applicationId: 'APP',
    });
    await cb('caas/charging-notification', {
      externalTrxId: started['chargeId'],
      statusCode: 'S1000',
      paidAmount: '5.00',
      balanceDue: '0',
    });
    await h.app.services.sms.enqueue({
      subscriberId: SUBSCRIBER,
      message: MESSAGE,
      purpose: 'REMINDER',
      idempotencyKey: 'pii-1',
    });
    await settle(h);
    await h.app.inject({ method: 'POST', url: `/api/applink/${KEY}/nope`, payload: {} });

    const all = log.text();
    expect(all.length).toBeGreaterThan(1000); // we really did capture the flow
    // ...and the flows we care about really were logged, just masked.
    expect(all).toContain('tel:880*******376');
    for (const msg of [
      'callback received',
      'sms submitted',
      'subscription notification applied',
      'charge settled',
    ]) {
      expect(all, msg).toContain(msg);
    }

    const secrets: Record<string, string> = {
      'local number': MSISDN_LOCAL,
      'international number': MSISDN_INTL,
      'subscriber id': SUBSCRIBER,
      'otp code': OTP,
      referenceNo: REF,
      requestCorrelator: CORR,
      'applink password': PASSWORD,
      'message text': MESSAGE,
      'callback key': KEY,
      'access token': String(verified['token']),
      'refresh token': String(verified['refreshToken']),
      'step-up token': String(stepUp['stepUpToken']),
      'jwt secret': 'x'.repeat(40),
    };
    for (const [what, value] of Object.entries(secrets)) {
      expect(all, `${what} leaked into the logs`).not.toContain(value);
    }
    await h.app.close();
  });
});

describe('boot guard', () => {
  it('buildApp still works with no logger stream and quiet logs', () => {
    const app = buildApp({ NODE_ENV: 'test' });
    expect(app).toBeTruthy();
  });
});
