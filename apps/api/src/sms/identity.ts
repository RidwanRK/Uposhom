import { subscriberIdVariants } from '@uposhom/applink-client';
import type { DomainPorts } from '../ports.js';
import type { Stores, UserRecord } from '../stores/types.js';

/**
 * Candidate forms for matching an address from a callback or charging-info lookup against the
 * opaque subscriberId we stored. Handles `tel:880...`, `tel:+880...`, and bare `880...` in both
 * directions while leaving masked or non-numeric ids untouched.
 */
export function addressCandidates(address: string): string[] {
  const trimmed = address.trim();
  const seen = new Set<string>(subscriberIdVariants(trimmed));
  const telNum = /^tel:\+?(\d+)$/i.exec(trimmed);
  const bareNum = /^\+?(\d+)$/.exec(trimmed);
  const digits = telNum?.[1] ?? bareNum?.[1];
  if (digits) {
    seen.add(`tel:${digits}`);
    seen.add(`tel:+${digits}`);
    seen.add(digits);
  }
  return [...seen];
}

/**
 * Resolves the address a callback carries to the subscriber id WE stored. Applink's samples use
 * `tel:880...` in some places and `tel:+880...` in others, so the same person can arrive in either
 * form. Everything we suppress, mirror or message is keyed by the stored form, so a STOP always
 * lands on the number it came from.
 *
 * The id may belong to an account holder (users.subscriber_id) or to a dependent's own phone bound
 * by Family Link (profiles.subscriber_id, checked through the domain port). An address that matches
 * nobody is returned as given: opt-outs are honoured for any number.
 */
export async function resolveSubscriber(
  stores: Pick<Stores, 'users'>,
  address: string,
  ports?: Pick<DomainPorts, 'isProfileSubscriber'>,
): Promise<{ id: string; user: UserRecord | null; isProfile: boolean }> {
  const candidates = addressCandidates(address);
  for (const candidate of candidates) {
    const user = await stores.users.findBySubscriberId(candidate);
    if (user) return { id: user.subscriberId ?? candidate, user, isProfile: false };
  }
  if (ports) {
    for (const candidate of candidates) {
      if (await ports.isProfileSubscriber(candidate)) {
        return { id: candidate, user: null, isProfile: true };
      }
    }
  }
  return { id: address, user: null, isProfile: false };
}
