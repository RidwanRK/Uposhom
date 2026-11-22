import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import type { Job, JobOptions, JobQueue } from './types.js';

/** Failed jobs end up here once their retries are used up. Reviewed daily (Master Plan section 8). */
export const DEAD_LETTER_QUEUE = 'dead-letter';

export interface PgBossQueue extends JobQueue {
  /** How many jobs have been dead-lettered and are still retained. */
  deadLetterCount(): Promise<number>;
}

export interface PgBossQueueOptions {
  connectionString: string;
  /** Schema pg-boss installs its tables into. Defaults to `pgboss`. */
  schema?: string;
  /** How often an idle worker polls. Replies a person is waiting on are latency sensitive, so this is short. */
  pollingIntervalSeconds?: number;
  onError?: (err: Error) => void;
}

/**
 * pg-boss on the VM's Postgres: durable, shared between the API and the worker, no Redis.
 *
 * Same behaviour as the in-memory queue, which the tests hold both to:
 *  - one job per singletonKey while it is queued or running (the `exclusive` policy, so a key is
 *    always set: a keyless job would otherwise block the whole queue);
 *  - retries with exponential backoff up to retryLimit, then the job moves to the dead-letter queue;
 *  - one job at a time per queue, which doubles as the SMS throttle.
 */
export function createPgBossQueue(opts: PgBossQueueOptions): PgBossQueue {
  const boss = new PgBoss({
    connectionString: opts.connectionString,
    ...(opts.schema ? { schema: opts.schema } : {}),
  });
  boss.on('error', (err) => opts.onError?.(err));

  const handlers = new Map<string, (job: Job) => Promise<void>>();
  const created = new Set<string>();
  let started: Promise<void> | undefined;

  async function ensureQueue(name: string): Promise<void> {
    if (created.has(name)) return;
    await boss.createQueue(DEAD_LETTER_QUEUE);
    await boss.createQueue(name, { policy: 'exclusive', deadLetter: DEAD_LETTER_QUEUE });
    created.add(name);
  }

  async function attach(name: string, handler: (job: Job) => Promise<void>): Promise<void> {
    await ensureQueue(name);
    await boss.work(
      name,
      { batchSize: 1, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 0.5 },
      async (jobs) => {
        for (const job of jobs) {
          await handler({ id: job.id, name, data: job.data, retryCount: job.retryCount });
        }
      },
    );
  }

  return {
    async send(name, data, options: JobOptions = {}) {
      await started; // jobs sent before start() wait for it rather than failing
      await ensureQueue(name);
      const retryDelay = options.retryDelaySeconds ?? 0;
      return boss.send(name, data as object, {
        singletonKey: options.singletonKey ?? randomUUID(),
        retryLimit: options.retryLimit ?? 0,
        retryDelay,
        retryBackoff: retryDelay > 0,
        ...(options.delaySeconds ? { startAfter: options.delaySeconds } : {}),
      });
    },

    work(name, handler) {
      handlers.set(name, handler as (job: Job) => Promise<void>);
      // Registered with pg-boss at start(), once the schema exists.
    },

    async start() {
      started = (async () => {
        await boss.start();
        for (const [name, handler] of handlers) await attach(name, handler);
      })();
      await started;
    },

    async stop() {
      await boss.stop({ graceful: true, timeout: 10_000 });
    },

    async deadLetterCount() {
      // findJobs reads the table directly. getQueues totals only refresh on a monitor pass.
      await started;
      await boss.createQueue(DEAD_LETTER_QUEUE);
      return (await boss.findJobs(DEAD_LETTER_QUEUE)).length;
    },
  };
}
