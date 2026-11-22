import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenService } from '../src/auth/tokens.js';
import { buildApp } from '../src/app.js';
import { createMemoryStores } from '../src/stores/memory.js';
import { startMockApplink, type MockApplink } from './helpers.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const MSISDN = '01973579363';

let mock: MockApplink;
beforeAll(async () => {
  mock = await startMockApplink(18090);
});
afterAll(() => mock.stop());

function app(
  opts: { applink?: ReturnType<MockApplink['client']> | undefined; now?: () => Date } = {},
) {
  return buildApp(
    { NODE_ENV: 'test', JWT_SECRET: SECRET },
    {
      stores: createMemoryStores(),
      applink: 'applink' in opts ? opts.applink : mock.client(),
      ...opts,
    },
  );
}

async function post(a: FastifyInstance, url: string, payload: unknown, ip = '10.0.0.1') {
  return a.inject({ method: 'POST', url, payload: payload as object, remoteAddress: ip });
}

describe('OTP sign-up on the Applink mock', () => {
  it('requests an OTP, verifies it and issues our own session', async () => {
    const a = app();
    const req = await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    expect(req.statusCode).toBe(200);
    expect(req.json()).toEqual({
      success: true,
      maskedPhone: '019****9363',
      expiresInSeconds: 300,
    });
    // referenceNo never reaches the app
    expect(req.body).not.toMatch(/reference/i);

    const ver = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '123456' });
    expect(ver.statusCode).toBe(200);
    const body = ver.json();
    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({ msisdn: '8801973579363', role: 'FAMILY_ADMIN' });
    expect(body.token).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    // subscriberId is opaque and stays server-side
    expect(ver.body).not.toMatch(/subscriber/i);

    const claims = await createTokenService(SECRET).verifyAccess(body.token);
    expect(claims).toEqual({ userId: body.user.id, role: 'FAMILY_ADMIN', isAdmin: false });
    expect(await mock.badRequests()).toEqual([]);
    await a.close();
  });

  it('creates a pharmacy owner when the account type says so', async () => {
    const a = app();
    await post(a, '/api/v1/auth/otp/request', { msisdn: '01811111111' });
    const ver = await post(a, '/api/v1/auth/otp/verify', {
      msisdn: '01811111111',
      otp: '123456',
      accountType: 'PHARMACY',
    });
    expect(ver.json().user.role).toBe('PHARMACY_OWNER');
    await a.close();
  });

  it('rotates refresh tokens, rejects reuse of the old one, and logout revokes', async () => {
    const a = app();
    await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    const { refreshToken } = (
      await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '123456' })
    ).json();

    const r1 = await post(a, '/api/v1/auth/refresh', { refreshToken });
    expect(r1.statusCode).toBe(200);
    const next = r1.json();
    expect(next.refreshToken).not.toBe(refreshToken);

    expect((await post(a, '/api/v1/auth/refresh', { refreshToken })).statusCode).toBe(401);

    await post(a, '/api/v1/auth/logout', { refreshToken: next.refreshToken });
    const after = await post(a, '/api/v1/auth/refresh', { refreshToken: next.refreshToken });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('INVALID_REFRESH');
    await a.close();
  });

  it('rejects numbers that are not Bangladeshi mobiles and malformed bodies', async () => {
    const a = app();
    const bad = await post(a, '/api/v1/auth/otp/request', { msisdn: '12345' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe('NUMBER_NOT_ACCEPTED');
    expect((await post(a, '/api/v1/auth/otp/request', {})).statusCode).toBe(400);
    expect(
      (await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: 'abcdef' })).statusCode,
    ).toBe(400);
    await a.close();
  });

  it('rate-limits OTP requests per number', async () => {
    const a = app();
    for (let i = 0; i < 3; i++) {
      expect(
        (await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN }, `10.0.1.${i}`)).statusCode,
      ).toBe(200);
    }
    const limited = await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN }, '10.0.1.99');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.json().error.retryAfterSeconds).toBeGreaterThan(0);
    await a.close();
  });

  it('rate-limits OTP requests per IP', async () => {
    const a = app();
    let last = 200;
    for (let i = 0; i < 11; i++) {
      last = (
        await post(
          a,
          '/api/v1/auth/otp/request',
          { msisdn: `0171000000${i}`.slice(0, 11) },
          '10.9.9.9',
        )
      ).statusCode;
    }
    expect(last).toBe(429);
    await a.close();
  });

  it('asks for a new code when there is no open session', async () => {
    const a = app();
    const ver = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '123456' });
    expect(ver.statusCode).toBe(410);
    expect(ver.json().error.code).toBe('OTP_EXPIRED');
    await a.close();
  });

  it('expires our session after five minutes, whatever Applink says', async () => {
    let t = new Date('2026-11-22T10:00:00Z');
    const a = app({ now: () => t });
    await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    t = new Date(t.getTime() + 301_000);
    const ver = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '123456' });
    expect(ver.json().error.code).toBe('OTP_EXPIRED');
    await a.close();
  });

  it('lets the user retry a wrong code on the same session, then caps attempts at five', async () => {
    const a = app({ applink: mock.clientWithVerifyFailure('E1850') });
    await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    for (let i = 0; i < 5; i++) {
      const ver = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '000000' });
      expect(ver.statusCode).toBe(401);
      expect(ver.json().error.code).toBe('OTP_WRONG');
    }
    const sixth = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '000000' });
    expect(sixth.statusCode).toBe(410);
    expect(sixth.json().error.code).toBe('OTP_EXPIRED');
    await a.close();
  });

  it.each([
    ['E1851', 410, 'OTP_EXPIRED'],
    ['E1855', 410, 'OTP_EXPIRED'],
    ['E1856', 503, 'SERVICE_TROUBLE'],
    ['E1603', 503, 'SERVICE_TROUBLE'],
  ])('maps Applink %s on verify to %s/%s, never a raw code', async (code, status, mapped) => {
    const a = app({ applink: mock.clientWithVerifyFailure(code) });
    await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    const ver = await post(a, '/api/v1/auth/otp/verify', { msisdn: MSISDN, otp: '123456' });
    expect(ver.statusCode).toBe(status);
    expect(ver.json().error.code).toBe(mapped);
    expect(ver.body).not.toContain(code);
    await a.close();
  });

  it.each([
    ['E1317', 422, 'NUMBER_NOT_ACCEPTED'],
    ['E1342', 403, 'NUMBER_BLOCKED'],
    ['E1343', 403, 'NOT_ON_TEST_LIST'],
    ['E1603', 503, 'SERVICE_TROUBLE'],
  ])('maps Applink %s on request to %s/%s', async (code, status, mapped) => {
    const a = app({ applink: mock.client(`/fail-${code}`) });
    const res = await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    expect(res.statusCode).toBe(status);
    expect(res.json().error.code).toBe(mapped);
    await a.close();
  });

  it('reports a retry-later when OTP is not enabled yet (no credentials)', async () => {
    const a = app({ applink: undefined });
    const res = await post(a, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_TROUBLE');
    await a.close();
  });
});
