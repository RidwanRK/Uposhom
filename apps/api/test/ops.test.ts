import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApplinkFromConfig } from '../src/applink.js';
import { createMemoryQueue } from '../src/queue/memory.js';
import { createWebhookAlerter, type Alerter } from '../src/ops/alerts.js';
import { fakeApplink, harness, ok, SUB } from './platform.js';
import { startMockApplink, type MockApplink } from './helpers.js';

describe('webhook alerter', () => {
  it('posts one message that works for both Slack (text) and Discord (content)', () => {
    const calls: { url: string; body: Record<string, string> }[] = [];
    const fetchSpy = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response('ok');
    }) as unknown as typeof fetch;
    const a = createWebhookAlerter({ url: 'https://hooks.example/abc', fetch: fetchSpy });
    a.alert('applink-configuration-error', { statusCode: 'E1313', service: 'otp-request' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://hooks.example/abc');
    expect(calls[0]?.body.text).toBe(
      '[uposhom] applink-configuration-error statusCode=E1313 service=otp-request',
    );
    expect(calls[0]?.body.content).toBe(calls[0]?.body.text);
  });

  it('sends the same kind of alert at most once per window, then again after it', () => {
    let t = 1_000_000;
    const sent: string[] = [];
    const a = createWebhookAlerter({
      url: 'https://hooks.example/abc',
      dedupeWindowMs: 60_000,
      now: () => t,
      fetch: (async () => {
        sent.push('x');
        return new Response('ok');
      }) as unknown as typeof fetch,
    });
    a.alert('down');
    a.alert('down');
    a.alert('different');
    expect(sent).toHaveLength(2);
    t += 61_000;
    a.alert('down');
    expect(sent).toHaveLength(3);
  });

  it('never throws into the caller when the webhook is unreachable, and reports the failure', async () => {
    const failures: string[] = [];
    const a = createWebhookAlerter({
      url: 'https://hooks.example/abc',
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
      onFailure: (k) => failures.push(k),
    });
    expect(() => a.alert('down')).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(failures).toEqual(['down']);
  });
});

describe('configuration errors raise an alert', () => {
  let mock: MockApplink;
  beforeAll(async () => {
    mock = await startMockApplink(18094);
  });
  afterAll(() => mock.stop());

  const clientFor = (scenario: string, alerts: Alerter) =>
    createApplinkFromConfig(
      {
        APPLINK_APP_ID: 'APP_MOCK',
        APPLINK_PASSWORD: 'x',
        APPLINK_SUBSCRIPTION_QUERY_BASE_URL: `http://127.0.0.1:18094${scenario}/subscription/query-base`,
      },
      alerts,
    );

  it.each(['E1303', 'E1313', 'E1309'])('%s (integration down) alerts a human', async (code) => {
    const alert = vi.fn();
    const client = clientFor(`/fail-${code}`, { alert });
    await expect(client?.queryBase()).rejects.toMatchObject({ statusCode: code });
    expect(alert).toHaveBeenCalledWith('applink-configuration-error', {
      statusCode: code,
      service: 'subscription-query-base',
    });
  });

  it('a user-level error such as E1317 does not', async () => {
    const alert = vi.fn();
    await expect(clientFor('/fail-E1317', { alert })?.queryBase()).rejects.toMatchObject({
      statusCode: 'E1317',
    });
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('scheduled jobs', () => {
  const stale = async (h: Awaited<ReturnType<typeof harness>>, n: number) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `tel:880170000${String(i).padStart(4, '0')}`;
      ids.push(id);
      await h.stores.subscriptions.upsert({ subscriberId: id, status: 'REGISTERED' }, h.clock.now);
    }
    return ids;
  };

  it('the sweep reconciles stale subscriptions in batches of ten and honours each entry', async () => {
    const calls: string[][] = [];
    const applink = fakeApplink({
      getSubscriberChargingInfo: async (ids: string[]) => {
        calls.push(ids);
        return ok({
          destinationResponses: ids.map((id, i) => ({
            subscriberId: id,
            subscriptionStatus: i === 0 ? 'UNREGISTERED' : 'REGISTERED',
            statusCode: i === 1 ? 'E1317' : 'S1000', // one entry rejected on its own
          })),
        });
      },
    });
    const h = await harness({ applink });
    const ids = await stale(h, 12);
    h.clock.now = new Date(h.clock.now.getTime() + 25 * 3600_000); // a day later: all stale

    const out = await h.app.services.jobs.sweepSubscriptions();
    expect(calls.map((c) => c.length)).toEqual([10, 2]);
    expect(out).toEqual({ checked: 12, updated: 10 });

    const first = await h.stores.subscriptions.get(ids[0] ?? '');
    expect(first).toMatchObject({ status: 'UNREGISTERED', confirmedBy: 'SWEEP' });
    expect(await h.stores.optOuts.suppressionFor(ids[0] ?? '')).toBe('STOP'); // missed STOP honoured
    // The rejected entry is left exactly as it was.
    expect((await h.stores.subscriptions.get(ids[1] ?? ''))?.confirmedBy).toBeNull();
    await h.app.close();
  });

  it('the sweep skips recently confirmed rows and does nothing without Applink', async () => {
    const applink = fakeApplink({
      getSubscriberChargingInfo: async () => ok({ destinationResponses: [] }),
    });
    const h = await harness({ applink });
    await h.stores.subscriptions.upsert(
      {
        subscriberId: SUB,
        status: 'REGISTERED',
        confirmedAt: h.clock.now,
        confirmedBy: 'NOTIFICATION',
      },
      h.clock.now,
    );
    await h.app.services.jobs.sweepSubscriptions();
    expect(applink.getSubscriberChargingInfo).not.toHaveBeenCalled();
    await h.app.close();

    const none = await harness({ applink: undefined });
    expect(await none.app.services.jobs.sweepSubscriptions()).toEqual({ checked: 0, updated: 0 });
    await none.app.close();
  });

  it('a failed lookup keeps the last known state and does not throw', async () => {
    const applink = fakeApplink({
      getSubscriberChargingInfo: async () => {
        throw new Error('down');
      },
    });
    const h = await harness({ applink });
    const [id] = await stale(h, 3);
    h.clock.now = new Date(h.clock.now.getTime() + 25 * 3600_000);
    await expect(h.app.services.jobs.sweepSubscriptions()).resolves.toEqual({
      checked: 0,
      updated: 0,
    });
    expect((await h.stores.subscriptions.get(id ?? ''))?.status).toBe('REGISTERED');
    await h.app.close();
  });

  it('the Base Size heartbeat reports the size, and alerts when the check fails', async () => {
    const good = await harness({
      applink: fakeApplink({ queryBase: async () => ({ ...ok({}), baseSize: '42', size: 42 }) }),
    });
    expect(await good.app.services.jobs.pollBaseSize()).toBe(42);
    await good.app.close();

    const alert = vi.fn();
    const bad = await harness({
      alerts: { alert },
      applink: fakeApplink({
        queryBase: async () => {
          throw new Error('down');
        },
      }),
    });
    expect(await bad.app.services.jobs.pollBaseSize()).toBeNull();
    expect(alert).toHaveBeenCalledWith('applink-basesize-failed', { statusCode: 'transport' });
    await bad.app.close();
  });

  it('the retention job purges old rows', async () => {
    const h = await harness();
    await h.stores.dedupe.firstSeen(
      'old-key',
      new Date(h.clock.now.getTime() - 31 * 24 * 3600_000),
    );
    const counts = await h.app.services.jobs.purgeOldData();
    expect(counts.callbackDedupe).toBe(1);
    await h.app.close();
  });

  it('the dead-letter review alerts only when there is something to look at', async () => {
    const alert = vi.fn();
    const queue = createMemoryQueue({ retryDelayScale: 0 });
    const h = await harness({ queue, alerts: { alert } });
    expect(await h.app.services.jobs.reviewDeadLetters()).toBe(0);
    expect(alert).not.toHaveBeenCalled();

    queue.work('broken', async () => {
      throw new Error('boom');
    });
    await queue.send('broken', {});
    await queue.idle();
    expect(await h.app.services.jobs.reviewDeadLetters()).toBe(1);
    expect(alert).toHaveBeenCalledWith('dead-letters', { count: 1 });
    await h.app.close();
  });

  it('a stuck charge alerts with identifiers only: no number, no amount', async () => {
    const alert = vi.fn();
    const applink = fakeApplink({
      startCharge: async (input: { externalTrxId: string }) => ({
        statusCode: 'P1003',
        statusDetail: 'OTP sent',
        externalTrxId: input.externalTrxId,
        requestCorrelator: 'corr-1',
        internalTrxId: 'int-77',
      }),
      confirmCharge: async () => ok({}),
    });
    const h = await harness({ applink, alerts: { alert } });
    const user = await h.addUser();
    const { chargeId } = (
      await h.api(user, 'POST', '/billing/caas/initiate', {
        purpose: 'DOCTOR_SUMMARY',
        consentWording: 'Charge 5.00 BDT.',
      })
    ).json();
    await h.api(user, 'POST', '/billing/caas/verify', { chargeId, otp: '931204' });

    h.clock.now = new Date(h.clock.now.getTime() + 3 * 3600_000);
    expect(await h.app.services.jobs.reconcileCharges()).toEqual({ expired: 0, stuck: 1 });
    expect(alert).toHaveBeenCalledTimes(1);
    const [kind, details] = alert.mock.calls[0] as [string, Record<string, unknown>];
    expect(kind).toBe(`charge-stuck ${chargeId}`);
    expect(details).toEqual({ internalTrxId: 'int-77' });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('8801959979376');
    await h.app.close();
  });
});

describe('queue schedules', () => {
  afterEach(() => vi.useRealTimers());

  it('fires a job at the cron time in the given zone, then arms the next one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T09:59:30Z')); // 15:59:30 in Dhaka
    const q = createMemoryQueue();
    const runs: string[] = [];
    q.work('nightly', async () => void runs.push(new Date().toISOString()));
    await q.schedule('nightly', '0 16 * * *', { tz: 'Asia/Dhaka' }); // 16:00 Dhaka = 10:00 UTC
    await q.start();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(runs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runs).toHaveLength(1);
    expect(Date.parse(runs[0] ?? '')).toBeGreaterThanOrEqual(
      Date.parse('2026-11-22T10:00:00.000Z'),
    );
    expect(Date.parse(runs[0] ?? '')).toBeLessThan(Date.parse('2026-11-22T10:00:01.000Z'));

    await vi.advanceTimersByTimeAsync(24 * 3600_000); // the next day's run is armed
    expect(runs).toHaveLength(2);
    await q.stop();
  });

  it('refuses a malformed cron expression immediately', async () => {
    const q = createMemoryQueue();
    await expect(q.schedule('x', 'not a cron')).rejects.toThrow();
  });

  it('stop() cancels pending schedules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T09:59:30Z'));
    const q = createMemoryQueue();
    let n = 0;
    q.work('nightly', async () => void n++);
    await q.schedule('nightly', '0 16 * * *', { tz: 'Asia/Dhaka' });
    await q.start();
    await q.stop();
    await vi.advanceTimersByTimeAsync(2 * 3600_000);
    expect(n).toBe(0);
  });
});
