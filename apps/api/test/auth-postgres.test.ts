import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});
