import { ApplinkError, toTelAddress } from '@uposhom/applink-client';
import type { CaasService } from '../billing/caas.js';
import type { SubscriptionService } from '../billing/subscriptions.js';
import type { ServiceDeps } from '../services/deps.js';

/** Queue names and their schedules (cron, Asia/Dhaka). One job at a time, no pile-ups. */
export const JOBS = {
  reconcileCharges: { queue: 'job.charges.reconcile', cron: '*/10 * * * *' },
  sweepSubscriptions: { queue: 'job.subscriptions.sweep', cron: '0 2 * * *' },
  pollBaseSize: { queue: 'job.applink.basesize', cron: '5 * * * *' },
  purgeOldData: { queue: 'job.retention.purge', cron: '30 3 * * *' },
  reviewDeadLetters: { queue: 'job.deadletters.review', cron: '0 9 * * *' },
} as const;

/** The sweep looks again at any subscription not confirmed in this long. */
export const SWEEP_STALE_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 10; // getSubscriberChargingInfo accepts at most 10 per call
const SWEEP_MAX_ROWS = 500;

/**
 * Scheduled platform jobs (Master Plan sections 8 and 18). None of them sits on a request path.
 * Each is a plain function so it can be tested directly, and `register` puts it on the queue.
 */
export function createJobs(deps: ServiceDeps, caas: CaasService, subs: SubscriptionService) {
  const { stores, log } = deps;

  /** Closes unused charge OTPs and flags charges that were submitted but never confirmed. */
  async function reconcileCharges() {
    const out = await caas.reconcile();
    if (out.expired || out.stuck) log.info(out, 'charge reconciliation');
    return out;
  }

  /**
   * Nightly sweep of getSubscriberChargingInfo: reconciles mirror rows whose notification we may
   * have missed. Branches on each entry's own statusCode. If the lookup fails the last known good
   * state keeps being served: nothing here can lock someone out.
   */
  async function sweepSubscriptions() {
    if (!deps.applink) return { checked: 0, updated: 0 };
    const cutoff = new Date(deps.now().getTime() - SWEEP_STALE_MS);
    const stale = await stores.subscriptions.listStale(cutoff, SWEEP_MAX_ROWS);
    let checked = 0;
    let updated = 0;

    for (let i = 0; i < stale.length; i += SWEEP_BATCH) {
      const batch = stale.slice(i, i + SWEEP_BATCH);
      const byNormalised = new Map(
        batch.map((r) => [toTelAddress(r.subscriberId), r.subscriberId]),
      );
      let res;
      try {
        res = await deps.applink.getSubscriberChargingInfo(batch.map((r) => r.subscriberId));
      } catch (err) {
        log.warn(
          { statusCode: err instanceof ApplinkError ? err.statusCode : 'transport' },
          'subscription sweep lookup failed: keeping last known state',
        );
        break;
      }
      for (const entry of res.destinationResponses ?? []) {
        checked++;
        if (entry.statusCode && entry.statusCode !== 'S1000') {
          log.warn({ statusCode: entry.statusCode }, 'subscription sweep entry rejected');
          continue;
        }
        const stored = byNormalised.get(toTelAddress(entry.subscriberId));
        if (!stored || !entry.subscriptionStatus) continue;
        await subs.handleNotification({
          subscriberId: stored,
          status: entry.subscriptionStatus,
          source: 'SWEEP',
        });
        updated++;
      }
    }
    log.info({ checked, updated }, 'subscription sweep done');
    return { checked, updated };
  }

  /** Base Size costs nothing and touches no one: a heartbeat for credentials, IP and provisioning. */
  async function pollBaseSize() {
    if (!deps.applink) return null;
    try {
      const res = await deps.applink.queryBase();
      log.info({ baseSize: res.size }, 'applink base size');
      return res.size;
    } catch (err) {
      const statusCode = err instanceof ApplinkError ? err.statusCode : 'transport';
      log.warn({ statusCode }, 'applink base size check failed');
      deps.alerts.alert('applink-basesize-failed', { statusCode });
      return null;
    }
  }

  async function purgeOldData() {
    const counts = await stores.maintenance.purge(deps.now());
    log.info(counts, 'retention purge');
    return counts;
  }

  /** Jobs that exhausted their retries sit in the dead-letter queue until someone looks. */
  async function reviewDeadLetters() {
    const n = (await deps.queue.deadLetterCount?.()) ?? 0;
    if (n > 0) deps.alerts.alert('dead-letters', { count: n });
    return n;
  }

  function register(): void {
    const wire = (def: { queue: string; cron: string }, run: () => Promise<unknown>) => {
      deps.queue.work(def.queue, async () => {
        await run();
      });
      void deps.queue.schedule(def.queue, def.cron, { tz: 'Asia/Dhaka' });
    };
    wire(JOBS.reconcileCharges, reconcileCharges);
    wire(JOBS.sweepSubscriptions, sweepSubscriptions);
    wire(JOBS.pollBaseSize, pollBaseSize);
    wire(JOBS.purgeOldData, purgeOldData);
    wire(JOBS.reviewDeadLetters, reviewDeadLetters);
  }

  return {
    reconcileCharges,
    sweepSubscriptions,
    pollBaseSize,
    purgeOldData,
    reviewDeadLetters,
    register,
  };
}

export type Jobs = ReturnType<typeof createJobs>;
