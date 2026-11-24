import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { createPhoneCrypto } from '../src/security/phone-crypto.js';
import { createPostgresStores } from '../src/stores/postgres.js';
import { startMockApplink, type MockApplink } from './helpers.js';

/** The OTP sign-up, refresh and logout flows, end to end on Postgres and the Applink mock. */
const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('OTP sign-up on the Postgres stores', () => {
  const schema = `t_${randomBytes(5).toString('hex')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let mock: MockApplink;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 5, options: `-c search_path=${schema}` });
    await runMigrations(pool);
    mock = await startMockApplink(18092);
  });

  afterAll(async () => {
    mock.stop();
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  it('signs up, stores only an encrypted number, and survives a restart of the API', async () => {
    const stores = createPostgresStores(pool, createPhoneCrypto(randomBytes(32).toString('hex')));
    const make = () =>
      buildApp(
        { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40) },
        { stores, applink: mock.client() },
      );
    const post = (a: ReturnType<typeof make>, p: string, payload: object) =>
      a.inject({ method: 'POST', url: `/api/v1/auth/${p}`, payload });

    const a = make();
    expect((await post(a, 'otp/request', { msisdn: '01959979376' })).statusCode).toBe(200);
    const ver = await post(a, 'otp/verify', { msisdn: '01959979376', otp: '123456' });
    expect(ver.statusCode).toBe(200);
    const body = ver.json();
    expect(body.user.msisdn).toBe('8801959979376');
    await a.close();

    // A different API instance (a restart) still knows the session: that is the point of Postgres.
    const b = make();
    const refreshed = await post(b, 'refresh', { refreshToken: body.refreshToken });
    expect(refreshed.statusCode).toBe(200);
    expect((await post(b, 'refresh', { refreshToken: body.refreshToken })).statusCode).toBe(401);

    const rows = JSON.stringify((await pool.query('SELECT * FROM users')).rows);
    expect(rows).not.toContain('1959979376');
    expect(await mock.badRequests()).toEqual([]);
    await b.close();
  });

  it('runs Subscription and a CaaS payment on Postgres: ledger, one grant, atomic counters', async () => {
    // The mock answers every OTP verify with the same subscriber id; real numbers each have their own.
    await pool.query('TRUNCATE users CASCADE');
    const stores = createPostgresStores(pool, createPhoneCrypto(randomBytes(32).toString('hex')));
    // The mock's debit answer does not echo our transaction id the way Applink does: patch it in.
    const echo: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      if (!String(input).endsWith('/caas/direct/debit')) return res;
      const sent = JSON.parse(String(init?.body ?? '{}')) as { externalTrxId?: string };
      const body = (await res.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...body, externalTrxId: sent.externalTrxId }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const app = buildApp(
      { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40) },
      { stores, applink: mock.client('', echo) },
    );
    const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      });

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/request',
      payload: { msisdn: '01811111111' },
    });
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/otp/verify',
      payload: { msisdn: '01811111111', otp: '123456' },
    });
    const { token, user } = signUp.json();

    // Subscription: consent, Register, then the Premium gate on real rows.
    const sub = await call('POST', '/api/v1/billing/subscription/subscribe', token, {
      consentAccepted: true,
      consentWording: 'Pay 30 BDT monthly.',
    });
    expect(sub.json().status).toBe('ACTIVE');
    expect((await call('GET', '/api/v1/billing/entitlements', token)).json().tier).toBe('PREMIUM');

    // CaaS: initiate, verify, then settle from the notification (partial first, then full).
    const started = await call('POST', '/api/v1/billing/caas/initiate', token, {
      purpose: 'DOCTOR_SUMMARY',
      consentWording: 'Charge 5.00 BDT.',
    });
    const { chargeId } = started.json();
    await call('POST', '/api/v1/billing/caas/verify', token, { chargeId, otp: '931204' });
    const note = (over: Record<string, string>) => ({
      externalTrxId: chargeId,
      internalTrxId: 'int-1',
      statusCode: 'S1000',
      paidAmount: '5.00',
      balanceDue: '0',
      ...over,
    });
    await app.inject({
      method: 'POST',
      url: '/api/applink/caas/charging-notification',
      payload: note({ statusCode: 'P1003', paidAmount: '2.00', balanceDue: '3.00' }),
    });
    await app.inject({
      method: 'POST',
      url: '/api/applink/caas/charging-notification',
      payload: note({}),
    });
    await vi.waitFor(async () =>
      expect((await stores.charges.get(chargeId))?.status).toBe('SETTLED'),
    );
    // The grant is written just after the charge is marked SETTLED, by the same queued job.
    await vi.waitFor(async () =>
      expect(await stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1),
    );

    // A replay cannot grant a second credit (UNIQUE on granted_by_charge).
    await app.services.caas.handleNotification(note({}));
    expect(await stores.entitlements.available(user.id, 'DOCTOR_SUMMARY')).toBe(1);

    // Atomic counters: forty reminders race for the thirty a free account would get, Premium has 500.
    const sms = await Promise.all(
      Array.from({ length: 40 }, () => app.services.entitlements.useSms(user.id)),
    );
    expect(sms.every((r) => r.allowed)).toBe(true); // Premium
    expect(await mock.badRequests()).toEqual([]);
    await app.close();
  });
});
