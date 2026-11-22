import { describe, expect, it, vi } from 'vitest';
import type { JobQueue } from '../src/queue/types.js';

export interface QueueUnderTest {
  queue: JobQueue;
  /** How many jobs have been dead-lettered. */
  deadLetters(): Promise<number>;
  cleanup(): Promise<void>;
}

/**
 * Behaviour every JobQueue implementation must share, so swapping the in-memory queue for pg-boss
 * cannot change what the SMS and unregister consumers rely on. Payloads are objects because
 * pg-boss stores JSON objects.
 */
export function queueContract(label: string, make: () => Promise<QueueUnderTest>): void {
  const waitFor = <T>(fn: () => T | Promise<T>) =>
    vi.waitFor(fn, { timeout: 20_000, interval: 50 });

  describe(`${label} queue contract`, { timeout: 40_000 }, () => {
    it('runs the jobs of a queue one at a time, in order', async () => {
      const t = await make();
      const order: string[] = [];
      let active = 0;
      let maxActive = 0;
      t.queue.work<{ n: string }>('contract.serial', async (job) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        order.push(job.data.n);
        active--;
      });
      await t.queue.start();
      for (const n of ['1', '2', '3']) {
        await t.queue.send('contract.serial', { n }, { singletonKey: `k${n}` });
      }
      await waitFor(() => expect(order).toEqual(['1', '2', '3']));
      expect(maxActive).toBe(1);
      await t.cleanup();
    });

    it('retries with a growing delay up to retryLimit, then dead-letters', async () => {
      const t = await make();
      const counts: number[] = [];
      t.queue.work('contract.retry', async (job) => {
        counts.push(job.retryCount);
        throw new Error('boom');
      });
      await t.queue.start();
      await t.queue.send('contract.retry', { a: 1 }, { retryLimit: 2, singletonKey: 'r1' });
      await waitFor(async () => expect(await t.deadLetters()).toBe(1));
      expect(counts).toEqual([0, 1, 2]);
      await t.cleanup();
    });

    it('does not retry when retryLimit is 0', async () => {
      const t = await make();
      let calls = 0;
      t.queue.work('contract.noretry', async () => {
        calls++;
        throw new Error('boom');
      });
      await t.queue.start();
      await t.queue.send('contract.noretry', { a: 1 }, { singletonKey: 'n1' });
      await waitFor(async () => expect(await t.deadLetters()).toBe(1));
      expect(calls).toBe(1);
      await t.cleanup();
    });

    it('drops a second job with the same singletonKey while one is pending, then allows it again', async () => {
      const t = await make();
      const seen: string[] = [];
      let release: () => void = () => undefined;
      const gate = new Promise<void>((r) => (release = r));
      t.queue.work<{ v: string }>('contract.single', async (job) => {
        await gate; // keeps the first job active so the duplicate is sent while it is pending
        seen.push(job.data.v);
      });
      await t.queue.start();

      expect(
        await t.queue.send('contract.single', { v: 'one' }, { singletonKey: 'k' }),
      ).not.toBeNull();
      expect(await t.queue.send('contract.single', { v: 'dup' }, { singletonKey: 'k' })).toBeNull();
      release();
      await waitFor(() => expect(seen).toEqual(['one']));

      await waitFor(async () =>
        expect(
          await t.queue.send('contract.single', { v: 'again' }, { singletonKey: 'k' }),
        ).not.toBeNull(),
      );
      await waitFor(() => expect(seen).toEqual(['one', 'again']));
      await t.cleanup();
    });

    it('lets jobs without a singletonKey queue side by side', async () => {
      const t = await make();
      let calls = 0;
      t.queue.work('contract.nokey', async () => void calls++);
      await t.queue.start();
      await t.queue.send('contract.nokey', { a: 1 });
      await t.queue.send('contract.nokey', { a: 2 });
      await waitFor(() => expect(calls).toBe(2));
      await t.cleanup();
    });

    it('honours delaySeconds', async () => {
      const t = await make();
      const at: number[] = [];
      t.queue.work('contract.delay', async () => void at.push(Date.now()));
      await t.queue.start();
      const t0 = Date.now();
      await t.queue.send('contract.delay', { a: 1 }, { delaySeconds: 2, singletonKey: 'd1' });
      await waitFor(() => expect(at).toHaveLength(1));
      expect((at[0] ?? 0) - t0).toBeGreaterThanOrEqual(1500);
      await t.cleanup();
    });
  });
}
