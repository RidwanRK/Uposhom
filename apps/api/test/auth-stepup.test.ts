import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTokenService } from '../src/auth/tokens.js';
import { createMemoryStores } from '../src/stores/memory.js';
import { applinkError, fakeApplink, ok } from './platform.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const MSISDN = '01959979376';

/** An Applink whose OTP calls succeed, answering with the given subscriber id on verify. */
function otpApplink(subscriberId: () => string = () => 'tel:sub-1') {
  return fakeApplink({
    requestOtp: async () => ok({ referenceNo: `ref-${Math.random()}` }),
    verifyOtp: async () => ok({ subscriberId: subscriberId(), subscriptionStatus: 'REGISTERED' }),
  });
}

async function setup(opts: { applink?: ReturnType<typeof otpApplink>; now?: () => Date } = {}) {
  const stores = createMemoryStores();
  const app = buildApp(
    { NODE_ENV: 'test', JWT_SECRET: SECRET },
    { stores, applink: opts.applink ?? otpApplink(), ...(opts.now ? { now: opts.now } : {}) },
  );
  // A probe route standing in for a sensitive action (removing a person, deleting data...).
  app.get('/probe/plain', { preHandler: app.authenticate }, async (req) => ({
    user: req.auth?.userId,
  }));
  app.post('/probe/sensitive', { preHandler: [app.authenticate, app.requireStepUp] }, async () => ({
    done: true,
  }));
  return { app, stores };
}

const post = (
  a: FastifyInstance,
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) => a.inject({ method: 'POST', url, payload: payload ?? {}, headers });

async function signIn(a: FastifyInstance, msisdn = MSISDN) {
  await post(a, '/api/v1/auth/otp/request', { msisdn });
  const res = await post(a, '/api/v1/auth/otp/verify', { msisdn, otp: '123456' });
  const body = res.json();
  return { token: body.token as string, userId: body.user.id as string };
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('authenticate', () => {
  it('lets a valid access token through and refuses everything else', async () => {
    const { app } = await setup();
    const { token, userId } = await signIn(app);

    const ok1 = await app.inject({ method: 'GET', url: '/probe/plain', headers: bearer(token) });
    expect(ok1.statusCode).toBe(200);
    expect(ok1.json()).toEqual({ user: userId });

    for (const headers of [
      {},
      bearer('garbage'),
      { authorization: token },
      { authorization: 'Basic abc' },
    ]) {
      const res = await app.inject({ method: 'GET', url: '/probe/plain', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
    await app.close();
  });

  it('rejects an expired access token', async () => {
    let clock = new Date('2020-01-01T00:00:00Z');
    const { app } = await setup({ now: () => clock });
    const { token } = await signIn(app);
    // Advance past the 15-minute access token TTL
    clock = new Date('2020-01-01T00:16:00Z');
    const res = await app.inject({ method: 'GET', url: '/probe/plain', headers: bearer(token) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a token signed with another secret', async () => {
    const { app } = await setup();
    const forged = await createTokenService('another-secret-another-secret-12345').signAccess({
      userId: 'usr_x',
      role: 'FAMILY_ADMIN',
      isAdmin: true,
    });
    const res = await app.inject({ method: 'GET', url: '/probe/plain', headers: bearer(forged) });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('step-up OTP', () => {
  it('needs a signed-in user', async () => {
    const { app } = await setup();
    expect((await post(app, '/api/v1/auth/step-up/request')).statusCode).toBe(401);
    expect((await post(app, '/api/v1/auth/step-up/verify', { otp: '123456' })).statusCode).toBe(
      401,
    );
    await app.close();
  });

  it('issues a step-up token that unlocks a sensitive action, once the code is verified', async () => {
    const { app } = await setup();
    const { token } = await signIn(app);

    // Without the token the sensitive route is refused, even for a signed-in user.
    const refused = await post(app, '/probe/sensitive', {}, bearer(token));
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED');

    expect((await post(app, '/api/v1/auth/step-up/request', {}, bearer(token))).json()).toEqual({
      success: true,
    });
    const ver = await post(app, '/api/v1/auth/step-up/verify', { otp: '654321' }, bearer(token));
    expect(ver.statusCode).toBe(200);
    const { stepUpToken } = ver.json();

    const allowed = await post(
      app,
      '/probe/sensitive',
      {},
      { ...bearer(token), 'x-step-up-token': stepUpToken },
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ done: true });
    await app.close();
  });

  it("sends the code to the signed-in user's own number, whatever the request says", async () => {
    const applink = otpApplink();
    const { app } = await setup({ applink });
    const { token } = await signIn(app);
    vi.mocked(applink.requestOtp).mockClear();
    await post(app, '/api/v1/auth/step-up/request', { msisdn: '01711111111' }, bearer(token));
    expect(applink.requestOtp).toHaveBeenCalledWith({ subscriberId: '8801959979376' });
    await app.close();
  });

  it('a step-up token is not an access token, and an access token is not a step-up token', async () => {
    const { app } = await setup();
    const { token, userId } = await signIn(app);
    await post(app, '/api/v1/auth/step-up/request', {}, bearer(token));
    const { stepUpToken } = (
      await post(app, '/api/v1/auth/step-up/verify', { otp: '654321' }, bearer(token))
    ).json();

    const asAccess = await app.inject({
      method: 'GET',
      url: '/probe/plain',
      headers: bearer(stepUpToken),
    });
    expect(asAccess.statusCode).toBe(401);

    const accessAsStepUp = await post(
      app,
      '/probe/sensitive',
      {},
      { ...bearer(token), 'x-step-up-token': token },
    );
    expect(accessAsStepUp.statusCode).toBe(403);
    void userId;
    await app.close();
  });

  it("refuses another user's step-up token", async () => {
    const { app } = await setup();
    const a = await signIn(app, '01959979376');
    const b = await signIn(app, '01711111111');
    await post(app, '/api/v1/auth/step-up/request', {}, bearer(a.token));
    const { stepUpToken } = (
      await post(app, '/api/v1/auth/step-up/verify', { otp: '654321' }, bearer(a.token))
    ).json();

    const res = await post(
      app,
      '/probe/sensitive',
      {},
      { ...bearer(b.token), 'x-step-up-token': stepUpToken },
    );
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('expires after five minutes', async () => {
    const tokens = createTokenService(SECRET);
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    expect(await tokens.verifyStepUp(await tokens.signStepUp('usr_1', sixMinutesAgo))).toBeNull();
    expect(await tokens.verifyStepUp(await tokens.signStepUp('usr_1', oneMinuteAgo))).toBe('usr_1');
  });

  it('a sign-up code cannot be spent as a step-up code', async () => {
    const { app } = await setup();
    const { token } = await signIn(app);
    // A new SIGN-UP code for the same number replaces any open session...
    await post(app, '/api/v1/auth/otp/request', { msisdn: MSISDN });
    // ...and verifying it as a step-up code must fail.
    const res = await post(app, '/api/v1/auth/step-up/verify', { otp: '123456' }, bearer(token));
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('OTP_EXPIRED');
    await app.close();
  });

  it('refuses when a different subscriber answers the code', async () => {
    let answer = 'tel:sub-1';
    const { app } = await setup({ applink: otpApplink(() => answer) });
    const { token } = await signIn(app);
    await post(app, '/api/v1/auth/step-up/request', {}, bearer(token));
    answer = 'tel:somebody-else';
    const res = await post(app, '/api/v1/auth/step-up/verify', { otp: '654321' }, bearer(token));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('OTP_WRONG');
    await app.close();
  });

  it('caps attempts like sign-up does, and rejects malformed codes', async () => {
    let failing = false;
    const applink = fakeApplink({
      requestOtp: async () => ok({ referenceNo: 'r' }),
      verifyOtp: async () => {
        if (failing) throw applinkError('E1850');
        return ok({ subscriberId: 'tel:sub-1', subscriptionStatus: 'REGISTERED' });
      },
    });
    const { app } = await setup({ applink });
    const { token } = await signIn(app);
    await post(app, '/api/v1/auth/step-up/request', {}, bearer(token));
    failing = true;

    for (let i = 0; i < 5; i++) {
      const res = await post(app, '/api/v1/auth/step-up/verify', { otp: '000000' }, bearer(token));
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('OTP_WRONG');
    }
    const sixth = await post(app, '/api/v1/auth/step-up/verify', { otp: '000000' }, bearer(token));
    expect(sixth.statusCode).toBe(410);

    const malformed = await post(app, '/api/v1/auth/step-up/verify', { otp: 'abc' }, bearer(token));
    expect(malformed.statusCode).toBe(400);
    await app.close();
  });
});
