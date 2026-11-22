import { subscriberIdVariants } from '@uposhom/applink-client';
import type { Stores, UserRecord } from '../stores/types.js';

/**
 * Resolves the address a callback carries to the subscriber id WE stored. Applink's samples use
 * `tel:880...` in some places and `tel:+880...` in others, so the same person can arrive in either
 * form. Everything we suppress, mirror or message is keyed by the stored form, so a STOP always
 * lands on the number it came from.
 *
 * An address that matches nobody is returned as given: opt-outs are honoured for any number.
 */
export async function resolveSubscriber(
  stores: Pick<Stores, 'users'>,
  address: string,
): Promise<{ id: string; user: UserRecord | null }> {
  for (const candidate of subscriberIdVariants(address)) {
    const user = await stores.users.findBySubscriberId(candidate);
    if (user) return { id: user.subscriberId ?? candidate, user };
  }
  return { id: address, user: null };
}
