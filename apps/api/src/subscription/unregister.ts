import { ApplinkError, hasSubscriptionStatus } from '@uposhom/applink-client';
import type { Job } from '../queue/types.js';
import type { ServiceDeps } from '../services/deps.js';
import type { SuppressionReason } from '../stores/types.js';

export const UNREGISTER_QUEUE = 'subscription.unregister';
const UNREGISTER_RETRY_LIMIT = 3;

type Source = 'SMS' | 'APP' | 'NOTIFICATION';

export interface UnregisterPayload {
  subscriberId: string;
  source: Source;
}

/**
 * Opt-out, in two steps so that stopping is immediate and the Applink call is reliable:
 *  1. record the suppression locally (messages to the number stop at once, including queued ones);
 *  2. queue an Applink Unregister, retried with backoff until the response says UNREGISTERED.
 * Applink has no "already unregistered" code, so the outcome is read from subscriptionStatus.
 */
export function createUnregisterService(deps: ServiceDeps) {
  async function optOut(input: { subscriberId: string; source: Source }): Promise<void> {
    const reason: SuppressionReason = 'STOP';
    await deps.stores.optOuts.suppress({ ...input, reason }, deps.now());
    await deps.queue.send(UNREGISTER_QUEUE, input, {
      singletonKey: input.subscriberId,
      retryLimit: UNREGISTER_RETRY_LIMIT,
      retryDelaySeconds: 10,
    });
  }

  async function handle(job: Job<UnregisterPayload>): Promise<void> {
    if (!deps.applink) {
      deps.log.warn({}, 'unregister not sent: Applink is not configured');
      return;
    }
    try {
      const res = await deps.applink.unregister(job.data.subscriberId);
      if (!hasSubscriptionStatus(res, 'UNREGISTERED')) {
        throw new Error('subscription still active after unregister');
      }
    } catch (err) {
      // Configuration and client errors will not fix themselves: stop retrying, but the local
      // suppression already holds, so no further messages go out.
      if (err instanceof ApplinkError && !err.retryable) {
        deps.log.error({ statusCode: err.statusCode }, 'unregister rejected by Applink');
        return;
      }
      throw err;
    }
  }

  return { optOut, handle };
}

export type UnregisterService = ReturnType<typeof createUnregisterService>;
