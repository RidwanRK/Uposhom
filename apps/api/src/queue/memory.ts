import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { DeadLetter, Job, JobOptions, JobQueue } from './types.js';

interface Pending {
  job: Job;
  options: JobOptions;
  runAt: number;
}

export interface MemoryQueue extends JobQueue {
  /** Resolves when nothing is queued, delayed or running. For tests. */
  idle(): Promise<void>;
  deadLetters(): DeadLetter[];
}

/**
 * In-memory queue: one handler per queue, one job at a time per queue (which is also the SMS
 * throttle), retries with exponential backoff, dead letters. State is lost on restart.
 */
export function createMemoryQueue(opts: { retryDelayScale?: number } = {}): MemoryQueue {
  const scale = opts.retryDelayScale ?? 1;
  const queues = new Map<string, Pending[]>();
  const handlers = new Map<string, (job: Job) => Promise<void>>();
  const running = new Set<string>();
  const keys = new Set<string>();
  const dead: DeadLetter[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const schedules = new Map<string, { cron: string; tz: string }>();
  const waiters: (() => void)[] = [];
  let started = false;
  let stopped = false;

  const backlog = (): number =>
    [...queues.values()].reduce((n, q) => n + q.length, 0) + running.size;

  function notifyIfIdle(): void {
    if (backlog() === 0) waiters.splice(0).forEach((w) => w());
  }

  function release(p: Pending): void {
    if (p.options.singletonKey) keys.delete(`${p.job.name}:${p.options.singletonKey}`);
  }

  function pump(name: string): void {
    if (!started || stopped || running.has(name)) return;
    const handler = handlers.get(name);
    const q = queues.get(name);
    if (!handler || !q) return;

    const now = Date.now();
    const idx = q.findIndex((p) => p.runAt <= now);
    if (idx === -1) {
      const next = Math.min(...q.map((p) => p.runAt));
      if (Number.isFinite(next)) {
        const t = setTimeout(
          () => {
            timers.delete(t);
            pump(name);
          },
          Math.max(0, next - now),
        );
        t.unref();
        timers.add(t);
      }
      return;
    }

    const [pending] = q.splice(idx, 1);
    if (!pending) return;
    running.add(name);
    void (async () => {
      try {
        await handler(pending.job);
        release(pending);
      } catch (err) {
        const limit = pending.options.retryLimit ?? 0;
        if (pending.job.retryCount < limit) {
          const base = (pending.options.retryDelaySeconds ?? 0) * 1000 * scale;
          q.push({
            job: { ...pending.job, retryCount: pending.job.retryCount + 1 },
            options: pending.options,
            runAt: Date.now() + base * 2 ** pending.job.retryCount,
          });
        } else {
          release(pending);
          dead.push({ job: pending.job, error: err instanceof Error ? err.name : 'error' });
        }
      } finally {
        running.delete(name);
        pump(name);
        notifyIfIdle();
      }
    })();
  }

  /** Waits for the next cron time, sends the job, then arms the next one. */
  function armSchedule(name: string, cron: string, tz: string): void {
    if (stopped) return;
    const next = CronExpressionParser.parse(cron, { currentDate: new Date(), tz }).next().toDate();
    const t = setTimeout(
      () => {
        timers.delete(t);
        void queueApi.send(name, {}, { singletonKey: `schedule:${name}` });
        armSchedule(name, cron, tz);
      },
      Math.max(0, next.getTime() - Date.now()),
    );
    t.unref();
    timers.add(t);
  }

  const queueApi: MemoryQueue = {
    async send(name, data, options = {}) {
      if (options.singletonKey) {
        const k = `${name}:${options.singletonKey}`;
        if (keys.has(k)) return null;
        keys.add(k);
      }
      const job: Job = { id: randomUUID(), name, data, retryCount: 0 };
      const list = queues.get(name) ?? [];
      queues.set(name, list);
      list.push({ job, options, runAt: Date.now() + (options.delaySeconds ?? 0) * 1000 });
      setImmediate(() => pump(name));
      return job.id;
    },

    work(name, handler) {
      handlers.set(name, handler as (job: Job) => Promise<void>);
      pump(name);
    },

    async schedule(name, cron, options = {}) {
      CronExpressionParser.parse(cron); // refuse a bad expression now, not at 3 AM
      schedules.set(name, { cron, tz: options.tz ?? 'Asia/Dhaka' });
    },

    async start() {
      started = true;
      for (const name of queues.keys()) pump(name);
      for (const [name, { cron, tz }] of schedules) armSchedule(name, cron, tz);
    },

    async stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
    },

    idle() {
      if (backlog() === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    deadLetters: () => [...dead],
    deadLetterCount: async () => dead.length,
  };
  return queueApi;
}
