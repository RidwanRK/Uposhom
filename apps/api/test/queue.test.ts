import { describe, expect, it } from 'vitest';
import { createMemoryQueue } from '../src/queue/memory.js';

describe('memory queue', () => {
  it('runs jobs for a queue one at a time, in order', async () => {
    const q = createMemoryQueue();
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    q.work<string>('a', async (job) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(job.data);
      active--;
    });
    await q.start();
    await q.send('a', '1');
    await q.send('a', '2');
    await q.send('a', '3');
    await q.idle();
    expect(order).toEqual(['1', '2', '3']);
    expect(maxActive).toBe(1);
  });

  it('holds jobs sent before start and runs them on start', async () => {
    const q = createMemoryQueue();
    const seen: string[] = [];
    q.work<string>('a', async (j) => void seen.push(j.data));
    await q.send('a', 'early');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual([]);
    await q.start();
    await q.idle();
    expect(seen).toEqual(['early']);
  });

  it('retries with backoff up to retryLimit, then dead-letters', async () => {
    const q = createMemoryQueue({ retryDelayScale: 0 });
    let calls = 0;
    const counts: number[] = [];
    q.work('a', async (job) => {
      calls++;
      counts.push(job.retryCount);
      throw new Error('boom');
    });
    await q.start();
    await q.send('a', {}, { retryLimit: 2 });
    await q.idle();
    expect(calls).toBe(3);
    expect(counts).toEqual([0, 1, 2]);
    expect(q.deadLetters()).toHaveLength(1);
    expect(q.deadLetters()[0]?.error).toBe('Error');
  });

  it('does not retry when retryLimit is 0', async () => {
    const q = createMemoryQueue();
    let calls = 0;
    q.work('a', async () => {
      calls++;
      throw new Error('boom');
    });
    await q.start();
    await q.send('a', {});
    await q.idle();
    expect(calls).toBe(1);
    expect(q.deadLetters()).toHaveLength(1);
  });

  it('drops a second job with the same singletonKey while one is pending, then allows it again', async () => {
    const q = createMemoryQueue();
    const seen: string[] = [];
    q.work<string>('a', async (j) => void seen.push(j.data));
    await q.start();
    expect(await q.send('a', 'one', { singletonKey: 'k' })).not.toBeNull();
    expect(await q.send('a', 'dup', { singletonKey: 'k' })).toBeNull();
    await q.idle();
    expect(await q.send('a', 'again', { singletonKey: 'k' })).not.toBeNull();
    await q.idle();
    expect(seen).toEqual(['one', 'again']);
  });

  it('honours delaySeconds', async () => {
    const q = createMemoryQueue();
    const at: number[] = [];
    q.work('a', async () => void at.push(Date.now()));
    await q.start();
    const t0 = Date.now();
    await q.send('a', {}, { delaySeconds: 0.05 });
    await q.idle();
    expect((at[0] ?? 0) - t0).toBeGreaterThanOrEqual(40);
  });
});
