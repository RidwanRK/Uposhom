import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createDb,
  doseEvents,
  familyCircles,
  prescriptionItems,
  prescriptions,
  profiles,
  runDomainMigrations,
  type Db,
} from '@uposhom/db';
import { DEFAULT_ANCHORS, generateSchedule } from '@uposhom/schedule-engine';
import { runMigrations } from '../src/db/migrate.js';
import { MIGRATIONS } from '../src/db/migrations.js';

/**
 * Workstream B's domain tables on a real Postgres, applied after A's tables exactly as the API
 * does at boot. Skipped without TEST_DATABASE_URL, like A's Postgres tests.
 */
const url = process.env['TEST_DATABASE_URL'];

describe.skipIf(!url)('domain schema on Postgres', () => {
  const schema = `t_${randomBytes(5).toString('hex')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;
  let db: Db;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString: url, max: 5, options: `-c search_path=${schema}` });
    db = createDb(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
  });

  it('applies after A, once, and is a no-op the second time', async () => {
    expect(await runMigrations(pool)).toEqual(MIGRATIONS.map((m) => m.id));
    expect(await runDomainMigrations(pool)).toEqual([
      '0000_extensions',
      '0001_domain_tables',
      '0002_invites',
    ]);
    expect(await runDomainMigrations(pool)).toEqual([]);

    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    // A's tables, B's 18, and the two migration ledgers.
    expect(rows[0]!.n).toBeGreaterThanOrEqual(18 + 2);
  });

  const userId = 'usr_test1';

  it('stores an engine schedule through Drizzle and reads it back in order', async () => {
    await pool.query(
      `INSERT INTO users (id, msisdn_hash, phone_enc, account_type) VALUES ($1, 'h1', 'enc', 'INDIVIDUAL')`,
      [userId],
    );
    await db.insert(familyCircles).values({ id: 'cir_1', ownerUserId: userId });
    await db
      .insert(profiles)
      .values({ id: 'prf_1', circleId: 'cir_1', userId, name: 'Rahim', relationship: 'SELF' });
    await db.insert(prescriptions).values({
      id: 'pre_1',
      profileId: 'prf_1',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedBy: userId,
      startDate: '2026-11-21',
    });
    await db.insert(prescriptionItems).values({
      id: 'itm_1',
      prescriptionId: 'pre_1',
      position: 0,
      brandName: 'Napa Extra',
      parsedPattern: '1+0+1',
      mealRelation: 'PC',
      durationDays: 3,
      isCritical: true,
    });

    const schedule = generateSchedule({
      items: [
        { key: 'itm_1', pattern: '1+0+1', mealRelation: 'PC', durationDays: 3, isCritical: true },
      ],
      anchors: DEFAULT_ANCHORS,
      startDate: '2026-11-21',
      now: '2026-11-21T00:00:00+06:00',
    });
    expect(schedule.events).toHaveLength(6);

    await db.insert(doseEvents).values(
      schedule.events.map((e, i) => ({
        id: `dose_${i}`,
        profileId: 'prf_1',
        prescriptionItemId: e.itemKey,
        idempotencyKey: e.key,
        courseDate: e.courseDate,
        slot: e.slot,
        quantity: String(e.quantity),
        mealRelation: e.mealRelation,
        dueAt: new Date(e.dueAtMs),
        isCritical: e.isCritical,
      })),
    );

    // Saving the same schedule again (a retried confirm) adds nothing.
    await db
      .insert(doseEvents)
      .values(
        schedule.events.map((e, i) => ({
          id: `dose_retry_${i}`,
          profileId: 'prf_1',
          prescriptionItemId: e.itemKey,
          idempotencyKey: e.key,
          courseDate: e.courseDate,
          slot: e.slot,
          quantity: String(e.quantity),
          mealRelation: e.mealRelation,
          dueAt: new Date(e.dueAtMs),
          isCritical: e.isCritical,
        })),
      )
      .onConflictDoNothing({ target: doseEvents.idempotencyKey });

    const stored = await db
      .select()
      .from(doseEvents)
      .where(eq(doseEvents.profileId, 'prf_1'))
      .orderBy(doseEvents.dueAt);
    expect(stored).toHaveLength(6);
    expect(stored.map((d) => d.dueAt.getTime())).toEqual(schedule.events.map((e) => e.dueAtMs));
    expect(stored[0]).toMatchObject({ status: 'SCHEDULED', stage: 'PENDING', quantity: '1.00' });
  });

  it('rejects bad data at the database too', async () => {
    const bad = (q: string) => expect(pool.query(q)).rejects.toThrow();
    await bad(`INSERT INTO profiles (id, circle_id, name, relationship, meal_morning, meal_noon)
               VALUES ('prf_bad', 'cir_1', 'X', 'SELF', '14:00', '13:00')`);
    await bad(`UPDATE dose_events SET status = 'LOST' WHERE id = 'dose_0'`);
    await bad(`UPDATE dose_events SET quantity = 0 WHERE id = 'dose_0'`);
    await bad(`UPDATE prescriptions SET confirmed_at = NULL WHERE id = 'pre_1'`);
    await bad(`INSERT INTO family_circles (id, owner_user_id) VALUES ('cir_2', '${userId}')`);
  });

  it('deleting the user removes their circle, profiles and doses', async () => {
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    const count = async (table: string) =>
      (await db.execute<{ n: number }>(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0]!
        .n;
    expect(await count('family_circles')).toBe(0);
    expect(await count('profiles')).toBe(0);
    expect(await count('dose_events')).toBe(0);
  });
});
