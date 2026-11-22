import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApplinkError,
  ApplinkNotConfiguredError,
  ApplinkTransportError,
  createApplinkClient,
  formatAmount,
  hasSubscriptionStatus,
  maskAddress,
  normalizeBdMsisdn,
  toTelAddress,
  type ServiceName,
} from '../src/index.js';

const PORT = 18089;
const BASE = `http://127.0.0.1:${PORT}`;
const MOCK = fileURLToPath(new URL('../../../scripts/mock-applink.mjs', import.meta.url));

const PATHS: Record<ServiceName, string> = {
  smsSend: '/sms/send',
  ussdSend: '/ussd/send',
  subscriptionSend: '/subscription/send',
  subscriptionQueryBase: '/subscription/query-base',
  subscriptionChargingInfo: '/subscription/getSubscriberChargingInfo',
  otpRequest: '/otp/request',
  otpVerify: '/otp/verify',
  caasOtpGeneration: '/caas/direct/debit',
  caasOtpVerify: '/caas/otp/verify',
};

function clientFor(scenario = '') {
  const endpoints = Object.fromEntries(
    Object.entries(PATHS).map(([k, p]) => [k, `${BASE}${scenario}${p}`]),
  );
  return createApplinkClient({
    applicationId: 'APP_MOCK',
    password: 'mock-not-a-real-password',
    endpoints,
    timeoutMs: 2000,
  });
}

let mock: ChildProcess;

beforeAll(async () => {
  mock = spawn(process.execPath, [MOCK, '--port', String(PORT), '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/__report`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('mock Applink did not start');
});

afterAll(() => {
  mock.kill();
});

describe('against the local Applink mock', () => {
  const sub = '01973579363';

  it('runs every wrapper and the mock sees only valid bodies', async () => {
    const c = clientFor();
    expect((await c.queryBase()).size).toBeGreaterThanOrEqual(0);
    await c.sendSms(sub, 'hello', { deliveryStatusRequest: '1' });
    await c.sendUssd({
      sessionId: 's1',
      destinationAddress: sub,
      message: 'hi',
      operation: 'mt-fin',
    });
    expect(hasSubscriptionStatus(await c.register(sub), 'REGISTERED')).toBeTypeOf('boolean');
    await c.unregister(sub);
    await c.getSubscriberChargingInfo([sub]);

    const otp = await c.requestOtp({ subscriberId: sub });
    expect(otp.referenceNo).toBeTruthy();
    const verified = await c.verifyOtp({ referenceNo: otp.referenceNo ?? '', otp: '123456' });
    expect(verified.subscriberId).toBeTruthy();

    // P1003 is the expected outcome of charge step 1: accepted, not thrown, nothing charged.
    const started = await c.startCharge({ subscriberId: sub, amount: '5', externalTrxId: 'trx1' });
    expect(started.statusCode).toBe('P1003');
    expect(started.requestCorrelator).toBeTruthy();
    await c.confirmCharge({
      requestCorrelator: started.requestCorrelator ?? '',
      otp: '123456',
      subscriberId: sub,
    });

    const report = (await (await fetch(`${BASE}/__report`)).json()) as {
      verdict: string;
      problems: string[];
    }[];
    const bad = report.filter((r) => r.verdict === 'BAD');
    expect(bad, JSON.stringify(bad)).toEqual([]);
  });

  it('raises a typed error on a failure body', async () => {
    const c = clientFor('/fail-E1313');
    await expect(c.queryBase()).rejects.toMatchObject({
      name: 'ApplinkError',
      statusCode: 'E1313',
      isConfiguration: true,
    });
    await expect(c.queryBase()).rejects.toBeInstanceOf(ApplinkError);
  });

  it('carries on through a variant body (strings sent as numbers, unknown fields added)', async () => {
    const c = clientFor('/variant');
    expect((await c.queryBase()).size).toBeGreaterThanOrEqual(0);
    const otp = await c.requestOtp({ subscriberId: sub });
    expect(otp.referenceNo).toBeTruthy();
  });

  it('times out instead of hanging', async () => {
    const c = createApplinkClient({
      applicationId: 'APP_MOCK',
      password: 'x',
      endpoints: { subscriptionQueryBase: `${BASE}/timeout/subscription/query-base` },
      timeoutMs: 300,
    });
    await expect(c.queryBase()).rejects.toBeInstanceOf(ApplinkTransportError);
  });
});

describe('guards', () => {
  it('refuses a service that is not enabled', () => {
    const c = createApplinkClient({ applicationId: 'a', password: 'b', endpoints: {} });
    expect(() => c.requestOtp({ subscriberId: '01973579363' })).toThrow(ApplinkNotConfiguredError);
  });

  it('refuses plain HTTP to a non-local host, so credentials cannot leak', async () => {
    const c = createApplinkClient({
      applicationId: 'a',
      password: 'b',
      endpoints: { subscriptionQueryBase: 'http://example.com/subscription/query-base' },
    });
    await expect(c.queryBase()).rejects.toBeInstanceOf(ApplinkTransportError);
  });

  it('classifies transient codes as retryable', () => {
    expect(new ApplinkError('E1603', 'x', 's').retryable).toBe(true);
    expect(new ApplinkError('E1850', 'x', 's').retryable).toBe(false);
  });
});

describe('helpers', () => {
  it('normalises addresses to tel: without a plus', () => {
    expect(toTelAddress('01973579363')).toBe('tel:8801973579363');
    expect(toTelAddress('+8801973579363')).toBe('tel:8801973579363');
    expect(toTelAddress('008801973579363')).toBe('tel:8801973579363');
    expect(toTelAddress('tel:+8801973579363')).toBe('tel:8801973579363');
    expect(() => toTelAddress('  ')).toThrow();
  });

  it('masks addresses to the last three digits', () => {
    expect(maskAddress('tel:8801973579363')).toBe('tel:880*******363');
  });

  it('accepts any Bangladeshi mobile number and rejects the rest', () => {
    expect(normalizeBdMsisdn('01973579363')).toBe('8801973579363');
    expect(normalizeBdMsisdn('+880 1973-579363')).toBe('8801973579363');
    expect(normalizeBdMsisdn('01212345678')).toBeNull();
    expect(normalizeBdMsisdn('019735')).toBeNull();
    expect(normalizeBdMsisdn('abc')).toBeNull();
  });

  it('formats money as a two-place decimal string and rejects zero and sub-poisha', () => {
    expect(formatAmount('5')).toBe('5.00');
    expect(formatAmount('5.5')).toBe('5.50');
    expect(() => formatAmount('0')).toThrow();
    expect(() => formatAmount('5.123')).toThrow();
    expect(() => formatAmount('-1')).toThrow();
  });
});
