import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPgBossQueue } from '../src/queue/pgboss.js';
import { queueContract } from './queue-contract.js';
import { applinkError, fakeApplink, harness, ok, SUB } from './platform.js';

/**
 * Runs against a real Postgres when TEST_DATABASE_URL is set, for example:
 *   docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=uposhom_test postgres:16-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/uposhom_test pnpm --filter @uposhom/api test
 * CI provides it from a postgres service. Without it this suite is skipped.
 */
const url = process.env['TEST_DATABASE_URL'];

const newSchema = (): string => `pgboss_t_${randomBytes(4).toString('hex')}`;

describe.skipIf(!url)('pg-boss in the platform', { timeout: 60_000 }, () => {
  const make = (schema = newSchema()) =>
    createPgBossQueue({ connectionString: url ?? '', schema, pollingIntervalSeconds: 0.5 });

  it('carries a USSD dial and a STOP through callback, queue, consumer and Applink', async () => {
    const queue = make();
    const h = await harness({ queue });
    await h.addUser();
    const base = {
      version: '1.0',
      applicationId: 'APP_1',
      sessionId: 'pg-s',
      sourceAddress: SUB,
      encoding: '440',
    };

    const t0 = Date.now();
    await h.callback('ussd/receive', {
      ...base,
      requestId: 'pg-1',
      ussdOperation: 'mo-init',
      message: '*195#',
    });
    await vi.waitFor(() => expect(h.applink.sendUssd).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });
    // The first screen has to reach the handset while the network session is still alive.
    expect(Date.now() - t0).toBeLessThan(3000);

    await h.callback('ussd/receive', {
      ...base,
      requestId: 'pg-2',
      ussdOperation: 'mo-cont',
      message: '5',
    });
    await vi.waitFor(() => expect(h.applink.sendUssd).toHaveBeenCalledTimes(2), {
      timeout: 10_000,
    });
    await h.callback('ussd/receive', {
      ...base,
      requestId: 'pg-3',
      ussdOperation: 'mo-cont',
      message: '1',
    });
    await vi.waitFor(() => expect(h.applink.unregister).toHaveBeenCalledWith(SUB), {
      timeout: 10_000,
    });
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    expect(await queue.deadLetterCount()).toBe(0);
    await h.app.close();
  });

  it('sends one SMS per idempotency key even when the job is enqueued twice', async () => {
    const queue = make();
    const h = await harness({ queue });
    const msg = {
      subscriberId: SUB,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'pg-sms-1',
    };
    await h.app.services.sms.enqueue(msg);
    await h.app.services.sms.enqueue(msg);
    await vi.waitFor(() => expect(h.applink.sendSms).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 1500));
    await h.app.services.sms.enqueue(msg);
    await new Promise((r) => setTimeout(r, 1500));
    expect(h.applink.sendSms).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('retries a transient SMS failure through pg-boss', async () => {
    const queue = make();
    let n = 0;
    const applink = fakeApplink({
      sendSms: async () => {
        if (++n === 1) throw applinkError('E1603');
        return ok({ requestId: 'pg-req', destinationResponses: [{ statusCode: 'S1000' }] });
      },
    });
    const h = await harness({ queue, applink });
    await h.app.services.sms.enqueue({
      subscriberId: SUB,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'pg-retry',
    });
    await vi.waitFor(() => expect(n).toBe(2), { timeout: 30_000 });
    await vi.waitFor(
      async () =>
        expect((await h.stores.smsLog.findByIdempotencyKey('pg-retry'))?.status).toBe('SUBMITTED'),
      { timeout: 10_000 },
    );
    await h.app.close();
  });

  it('keeps queued jobs across a restart: a job sent while nobody consumes runs once a worker starts', async () => {
    const schema = newSchema();
    const first = make(schema);
    await first.start(); // no consumers registered
    await first.send('restart.demo', { n: 1 }, { singletonKey: 'r1' });
    await first.stop();

    const second = make(schema);
    const seen: number[] = [];
    second.work<{ n: number }>('restart.demo', async (job) => void seen.push(job.data.n));
    await second.start();
    await vi.waitFor(() => expect(seen).toEqual([1]), { timeout: 10_000 });
    await second.stop();
  });
});

describe.skipIf(!url)('pg-boss', () => {
  queueContract('pg-boss', async () => {
    // A schema of its own per test keeps runs from seeing each other's jobs.
    const queue = createPgBossQueue({
      connectionString: url ?? '',
      schema: `pgboss_t_${randomBytes(4).toString('hex')}`,
      pollingIntervalSeconds: 0.5,
    });
    return {
      queue,
      deadLetters: () => queue.deadLetterCount(),
      cleanup: () => queue.stop(),
    };
  });
});
