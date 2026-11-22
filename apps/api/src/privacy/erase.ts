import { maskAddress } from '@uposhom/applink-client';
import type { ServiceDeps } from '../services/deps.js';
import type { UnregisterService } from '../subscription/unregister.js';
import type { UserRecord } from '../stores/types.js';

/**
 * Delete my data (Master Plan section 5 and 8). Order matters:
 *
 *  1. the domain layer erases its rows first, because they refer to the user;
 *  2. the Applink subscription is ended and a STOP entry is recorded and KEPT, so the number is
 *     never messaged again. The entry holds the opaque subscriber id and nothing else: no phone
 *     number, no name. Applink Unregister is retried from the queue until it takes;
 *  3. the Applink-side data goes: sessions, consents, OTP sessions, the SMS log and subscription
 *     mirror, entitlements, counters, and the account. Charges stay as anonymous ledger entries
 *     so a charging dispute can still be investigated.
 *
 * The caller must already have required a step-up token: deleting an account is exactly the
 * sort of action that re-proves the phone.
 */
export function createPrivacyService(deps: ServiceDeps, unregister: UnregisterService) {
  async function eraseAccount(user: UserRecord): Promise<void> {
    await deps.ports.eraseDomainData(user.id);
    if (user.subscriberId) {
      await unregister.optOut({ subscriberId: user.subscriberId, source: 'APP' });
    }
    await deps.stores.users.erase(user.id);
    deps.log.info(
      { subscriber: user.subscriberId ? maskAddress(user.subscriberId) : 'none' },
      'account erased',
    );
  }
  return { eraseAccount };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
