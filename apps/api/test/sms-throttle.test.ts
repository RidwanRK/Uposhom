import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createMemoryQueue } from '../src/queue/memory.js';
import { applinkError, fakeApplink, ok, SUB } from './platform.js';

async function app(opts: {
  maxPerSecond?: number;
  applink: ReturnType<typeof fakeApplink>;
  alert?: (kind: string, details?: Record<string, string | number | boolean>) => void;
}) {
  const queue = createMemoryQueue({ retryDelayScale: 0 });
  const a = buildApp(
    {
      NODE_ENV: 'test',
      ...(opts.maxPerSecond ? { SMS_MAX_PER_SECOND: opts.maxPerSecond } : {}),
    },
    { queue, applink: opts.applink, ...(opts.alert ? { alerts: { alert: opts.alert } } : {}) },
  );
  await a.ready();
  return { app: a, queue };
}

const send = (a: Awaited<ReturnType<typeof app>>, n: number) =>
  Promise.all(
    Array.from({ length: n }, (_, i) =>
      a.app.services.sms.enqueue({
        subscriberId: `${SUB}${i}`,
        message: 'x',
        purpose: 'REMINDER',
        idempotencyKey: `t-${i}-${Math.random()}`,
      }),
    ),
  );

describe('outbound SMS throttle (Applink per-second limit)', () => {
  it('spaces sends so they never exceed SMS_MAX_PER_SECOND', async () => {
    const times: number[] = [];
    const applink = fakeApplink({
      sendSms: async () => {
        times.push(Date.now());
        return ok({ requestId: 'r', destinationResponses: [{ statusCode: 'S1000' }] });
      },
    });
    const a = await app({ maxPerSecond: 20, applink }); // 50 ms apart
    await send(a, 5);
    await a.queue.idle();
    expect(times).toHaveLength(5);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(45);
    }
    await a.app.close();
  });

  it('adds no delay when no limit is configured', async () => {
    const times: number[] = [];
    const applink = fakeApplink({
      sendSms: async () => {
        times.push(Date.now());
        return ok({ requestId: 'r', destinationResponses: [{ statusCode: 'S1000' }] });
      },
    });
    const a = await app({ applink });
    await send(a, 5);
    await a.queue.idle();
    expect((times.at(-1) ?? 0) - (times[0] ?? 0)).toBeLessThan(40);
    await a.app.close();
  });

  it('a per-second rejection (E1318) is retried and then succeeds, without losing the message', async () => {
    let n = 0;
    const applink = fakeApplink({
      sendSms: async () => {
        if (++n < 3) throw applinkError('E1318');
        return ok({ requestId: 'r', destinationResponses: [{ statusCode: 'S1000' }] });
      },
    });
    const a = await app({ applink });
    await send(a, 1);
    await a.queue.idle();
    expect(n).toBe(3);
    expect(a.queue.deadLetters()).toHaveLength(0);
    await a.app.close();
  });

  it('the per-day ceiling (E1319) cannot clear today: it fails after the retries and alerts a human', async () => {
    const alert = vi.fn();
    const applink = fakeApplink({
      sendSms: async () => {
        throw applinkError('E1319');
      },
    });
    const a = await app({ applink, alert });
    await send(a, 1);
    await a.queue.idle();
    expect(applink.sendSms).toHaveBeenCalledTimes(4); // first try plus three retries
    expect(alert).toHaveBeenCalledWith('applink-daily-sms-limit', { statusCode: 'E1319' });
    await a.app.close();
  });
});
