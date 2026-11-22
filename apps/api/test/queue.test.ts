import { describe, expect, it } from 'vitest';
import { createMemoryQueue } from '../src/queue/memory.js';
import { queueContract } from './queue-contract.js';

queueContract('memory', async () => {
  const queue = createMemoryQueue();
  return {
    queue,
    deadLetters: async () => queue.deadLetters().length,
    cleanup: () => queue.stop(),
  };
});

describe('memory queue specifics', () => {
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

  it('applies retryDelayScale to the backoff (tests run it at 0)', async () => {
    const q = createMemoryQueue({ retryDelayScale: 0 });
    let calls = 0;
    q.work('a', async () => {
      calls++;
      throw new Error('boom');
    });
    await q.start();
    await q.send('a', {}, { retryLimit: 3, retryDelaySeconds: 60 });
    await q.idle();
    expect(calls).toBe(4);
  });
});
