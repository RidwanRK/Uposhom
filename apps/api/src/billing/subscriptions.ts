import { ApplinkError, ApplinkTransportError, maskAddress } from '@uposhom/applink-client';
import { ApiError } from '../errors.js';
import type { ServiceDeps } from '../services/deps.js';
import type { UnregisterService } from '../subscription/unregister.js';
import type { SubscriptionPlan, UserRecord } from '../stores/types.js';
import { planConsentKind } from './config.js';

/** Only these two mean the subscriber can use the service. */
export const ACTIVE_STATES = new Set(['REGISTERED', 'TRIAL']);

export type SubscriptionView = {
  status: 'INACTIVE' | 'PENDING' | 'ACTIVE' | 'CANCELLED';
  plan?: SubscriptionPlan;
  amount?: string;
  currency?: string;
  lastConfirmedAt: string | null;
  /** TEMPORARY_BLOCKED: a billing failure. Keep the account, show the fix-payment path. */
  billingIssue?: boolean;
};

export const planFor = (user: UserRecord): SubscriptionPlan =>
  user.accountType === 'PHARMACY' ? 'PHARMACY' : 'FAMILY_CIRCLE';

/** Applink status codes mapped to what the app may see. Never a raw code. */
function mapRegisterError(err: unknown): ApiError {
  if (err instanceof ApplinkError) {
    if (err.statusCode === 'E1343') return new ApiError('NOT_ON_TEST_LIST', 403);
    if (err.statusCode === 'E1342') return new ApiError('NUMBER_BLOCKED', 403);
    if (err.statusCode === 'E1317') return new ApiError('NUMBER_NOT_ACCEPTED', 422);
  }
  return new ApiError('SERVICE_TROUBLE', 503);
}

/**
 * Premium subscriptions (Family Circle and the pharmacy plan).
 *
 * The Premium gate (Master Plan section 8) is ALL of:
 *   1. an active subscriptions_mirror row for the user's subscriber id (REGISTERED or TRIAL),
 *   2. a recorded consent row for the plan, and
 *   3. a Register call that WE made for that plan.
 * `/otp/verify` already returns REGISTERED at free sign-up, so an active status alone never
 * unlocks anything. A notification is not authorisation either: it only updates the mirror.
 * Nothing here calls Applink on a read path: status comes from the mirror.
 */
export function createSubscriptionService(deps: ServiceDeps, unregister: UnregisterService) {
  const { stores, billing, log } = deps;

  async function isPremium(user: UserRecord): Promise<boolean> {
    if (!user.subscriberId) return false;
    const sub = await stores.subscriptions.get(user.subscriberId);
    if (!sub || !ACTIVE_STATES.has(sub.status)) return false;
    if (!sub.plan || !sub.registerRequestedAt) return false;
    return stores.consents.hasKind(user.id, planConsentKind(sub.plan));
  }

  async function view(user: UserRecord): Promise<SubscriptionView> {
    const sub = user.subscriberId ? await stores.subscriptions.get(user.subscriberId) : null;
    const confirmed = sub?.lastConfirmedAt?.toISOString() ?? null;
    if (!sub) return { status: 'INACTIVE', lastConfirmedAt: null };

    const plan = sub.plan ?? undefined;
    const price = plan ? billing.plans[plan] : undefined;
    const withPlan = {
      ...(plan ? { plan } : {}),
      ...(price ? { amount: price.amount, currency: price.currency } : {}),
      lastConfirmedAt: confirmed,
    };

    if (sub.status === 'REG_PENDING') return { status: 'PENDING', ...withPlan };
    if (sub.status === 'TEMPORARY_BLOCKED') {
      return { status: 'INACTIVE', ...withPlan, billingIssue: true };
    }
    if (ACTIVE_STATES.has(sub.status)) {
      return (await isPremium(user))
        ? { status: 'ACTIVE', ...withPlan }
        : { status: 'INACTIVE', lastConfirmedAt: confirmed }; // free sign-up: registered, not Premium
    }
    if (sub.status === 'UNREGISTERED' && sub.registerRequestedAt) {
      return { status: 'CANCELLED', ...withPlan };
    }
    return { status: 'INACTIVE', lastConfirmedAt: confirmed };
  }

  /**
   * Subscribe to the user's plan. The consent row (wording, amount, currency, frequency, channel,
   * IP) is written BEFORE Register is called. Register is never retried blindly: after a timeout
   * the answer comes from the subscriber notification or the nightly sweep.
   */
  async function subscribe(
    user: UserRecord,
    input: { wording: string; ip: string },
  ): Promise<SubscriptionView> {
    if (!user.subscriberId) throw new ApiError('SERVICE_TROUBLE', 503);
    if (!deps.applink) throw new ApiError('SERVICE_TROUBLE', 503);
    if (await isPremium(user)) return view(user); // already subscribed: nothing to do

    const plan = planFor(user);
    const price = billing.plans[plan];
    const now = deps.now();

    await stores.consents.record(
      {
        userId: user.id,
        kind: planConsentKind(plan),
        channel: 'APP',
        ip: input.ip,
        wording: input.wording,
        amount: price.amount,
        currency: price.currency,
        frequency: price.frequency,
      },
      now,
    );
    // Fresh, recorded consent is what allows a person who said STOP to be subscribed again.
    await stores.optOuts.clearStop(user.subscriberId);
    await stores.subscriptions.upsert(
      { subscriberId: user.subscriberId, userId: user.id, plan, registerRequestedAt: now },
      now,
    );

    let status: string;
    try {
      const res = await deps.applink.register(user.subscriberId);
      status = (res.subscriptionStatus ?? '').trim().toUpperCase().replace(/\.$/, '');
    } catch (err) {
      if (err instanceof ApplinkTransportError) {
        // It may have gone through. Leave it pending: the notification or the sweep settles it.
        log.warn({ subscriber: maskAddress(user.subscriberId) }, 'register outcome unknown');
        await stores.subscriptions.upsert(
          { subscriberId: user.subscriberId, status: 'REG_PENDING' },
          deps.now(),
        );
        return view(user);
      }
      log.warn(
        {
          subscriber: maskAddress(user.subscriberId),
          statusCode: (err as { statusCode?: string }).statusCode,
        },
        'register failed',
      );
      throw mapRegisterError(err);
    }

    if (ACTIVE_STATES.has(status)) {
      await stores.subscriptions.upsert(
        {
          subscriberId: user.subscriberId,
          status,
          frequency: price.frequency,
          confirmedAt: deps.now(),
          confirmedBy: 'REGISTER_RESPONSE',
        },
        deps.now(),
      );
    } else if (status === 'REG_PENDING') {
      await stores.subscriptions.upsert({ subscriberId: user.subscriberId, status }, deps.now());
    } else {
      // Anything else (UNREGISTERED, INITIAL, blocked): the request did not take effect.
      log.warn({ subscriber: maskAddress(user.subscriberId), status }, 'register did not activate');
      throw new ApiError('SERVICE_TROUBLE', 503);
    }
    return view(user);
  }

  /**
   * Cancel. Messages to the number stop at once (local suppression) and the Applink Unregister is
   * retried from the queue until the response says UNREGISTERED. The Premium gate closes now.
   * Applink holds one subscription per subscriber, so cancelling it also ends reminder SMS.
   */
  async function unsubscribe(user: UserRecord): Promise<SubscriptionView> {
    if (!user.subscriberId) throw new ApiError('SERVICE_TROUBLE', 503);
    await stores.subscriptions.upsert(
      {
        subscriberId: user.subscriberId,
        userId: user.id,
        status: 'UNREGISTERED',
        confirmedAt: deps.now(),
        confirmedBy: 'REGISTER_RESPONSE',
      },
      deps.now(),
    );
    await unregister.optOut({ subscriberId: user.subscriberId, source: 'APP' });
    return view(user);
  }

  /**
   * The subscriber notification: the authoritative source of subscription state, including changes
   * we did not start (a subscriber texting STOP, an operator removal, a failed recurring charge).
   * It updates the mirror and nothing else: it never grants Premium by itself.
   */
  async function handleNotification(data: {
    subscriberId: string;
    status: string;
    frequency?: string | undefined;
    /** NOTIFICATION from the callback, SWEEP from the nightly reconciliation. */
    source?: 'NOTIFICATION' | 'SWEEP';
  }): Promise<void> {
    const status = data.status.trim().toUpperCase().replace(/\.$/, '');
    const user = await stores.users.findBySubscriberId(data.subscriberId);
    const now = deps.now();

    if (!user) {
      // Stored and flagged, never unlocked: no account, no consent, no Register of ours.
      log.warn(
        { subscriber: maskAddress(data.subscriberId), status },
        'subscription notification for unknown subscriber',
      );
    }
    await stores.subscriptions.upsert(
      {
        subscriberId: data.subscriberId,
        ...(user ? { userId: user.id } : {}),
        status,
        ...(data.frequency ? { frequency: data.frequency } : {}),
        confirmedAt: now,
        confirmedBy: data.source ?? 'NOTIFICATION',
      },
      now,
    );

    if (status === 'UNREGISTERED') {
      // Someone left through a channel we do not control: honour it like any other STOP.
      await stores.optOuts.suppress(
        { subscriberId: data.subscriberId, reason: 'STOP', source: 'NOTIFICATION' },
        now,
      );
    }
    log.info(
      { subscriber: maskAddress(data.subscriberId), status },
      'subscription notification applied',
    );
  }

  return { isPremium, view, subscribe, unsubscribe, handleNotification };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
