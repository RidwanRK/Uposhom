import { ApplinkError, ApplinkTransportError, maskAddress } from '@uposhom/applink-client';
import { ApiError } from '../errors.js';
import type { ServiceDeps } from '../services/deps.js';
import type { UnregisterService } from '../subscription/unregister.js';
import type { SubscriptionPlan, SubscriptionRecord, UserRecord } from '../stores/types.js';
import { resolveSubscriber } from '../sms/identity.js';
import { planConsentKind } from './config.js';

/** Only these two mean the subscriber can use the service. */
export const ACTIVE_STATES = new Set(['REGISTERED', 'TRIAL']);

/** Applink accepted the request and is still awaiting subscriber confirmation or billing. */
const PENDING_STATES = new Set(['INITIAL', 'REG_PENDING']);

/**
 * After Register, Applink texts the subscriber ("Applink Uposhom চালু করতে, ৬০ মিনিটের মধ্যে ...
 * A লিখে এসএমএস করুন") and the plan only starts once they reply. Until then Register answers
 * INITIAL or REG_PENDING, and the subscriber notification later reports REGISTERED. We wait this
 * long (Applink's own window) before letting the person ask again.
 */
export const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

/** A billing failure, not a step on the way to active. */
const BLOCKED_STATES = new Set(['TEMPORARY_BLOCKED', 'BLOCKED']);

/**
 * True while our Register is waiting for the subscriber's SMS confirmation: we asked recently, the
 * status is not active yet, and Applink has not reported a final outcome since our request.
 */
export function awaitingConfirmation(sub: SubscriptionRecord, now: Date): boolean {
  if (!sub.registerRequestedAt) return false;
  if (ACTIVE_STATES.has(sub.status) || BLOCKED_STATES.has(sub.status)) return false;
  if (now.getTime() - sub.registerRequestedAt.getTime() >= CONFIRM_WINDOW_MS) return false;
  if (PENDING_STATES.has(sub.status)) return true;
  // Any final word since our request settles it: a notification, the sweep, or the person cancelling.
  const heardSince = sub.lastConfirmedAt !== null && sub.lastConfirmedAt >= sub.registerRequestedAt;
  return !heardSince;
}

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

    if (awaitingConfirmation(sub, deps.now())) return { status: 'PENDING', ...withPlan };
    if (sub.status === 'TEMPORARY_BLOCKED') {
      return { status: 'INACTIVE', ...withPlan, billingIssue: true };
    }
    if (ACTIVE_STATES.has(sub.status)) {
      return (await isPremium(user))
        ? { status: 'ACTIVE', ...withPlan }
        : { status: 'INACTIVE', lastConfirmedAt: confirmed }; // free sign-up: registered, not Premium
    }
    // Cancelled only when the stop came after our Register (an app cancel, a STOP, an operator
    // removal), not when a request simply was never confirmed.
    if (
      sub.status === 'UNREGISTERED' &&
      sub.registerRequestedAt &&
      sub.lastConfirmedAt &&
      sub.lastConfirmedAt >= sub.registerRequestedAt
    ) {
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
    const before = await stores.subscriptions.get(user.subscriberId);
    // Already asked and the confirmation SMS is with the person: never send a second Register.
    if (before && awaitingConfirmation(before, deps.now())) return view(user);
    // Copied now: a store may hand back the live row, which the upsert below changes.
    const previous = {
      registerRequestedAt: before?.registerRequestedAt ?? null,
      plan: before?.plan ?? null,
    };

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

    const settledSinceRequest = async (): Promise<boolean> => {
      const current = await stores.subscriptions.get(user.subscriberId!);
      return Boolean(
        current &&
          current.lastConfirmedAt &&
          current.lastConfirmedAt >= now &&
          !PENDING_STATES.has(current.status),
      );
    };

    let status: string;
    try {
      const res = await deps.applink.register(user.subscriberId);
      status = (res.subscriptionStatus ?? '').trim().toUpperCase().replace(/\.$/, '');
    } catch (err) {
      if (err instanceof ApplinkTransportError) {
        // It may have gone through. Leave it pending: the notification or the sweep settles it.
        log.warn({ subscriber: maskAddress(user.subscriberId) }, 'register outcome unknown');
        if (!(await settledSinceRequest())) {
          await stores.subscriptions.upsert(
            { subscriberId: user.subscriberId, status: 'REG_PENDING' },
            deps.now(),
          );
        }
        return view(user);
      }
      log.warn(
        {
          subscriber: maskAddress(user.subscriberId),
          statusCode: (err as { statusCode?: string }).statusCode,
        },
        'register failed',
      );
      // The request did not take effect: undo our mark, so a number that was already REGISTERED
      // at sign-up cannot pass the Premium gate without a Register that worked.
      await stores.subscriptions.upsert(
        {
          subscriberId: user.subscriberId,
          ...previous,
        },
        deps.now(),
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
    } else if (BLOCKED_STATES.has(status)) {
      // A billing block: the request cannot take effect now.
      log.warn({ subscriber: maskAddress(user.subscriberId), status }, 'register blocked');
      await stores.subscriptions.upsert(
        {
          subscriberId: user.subscriberId,
          status,
          ...previous,
        },
        deps.now(),
      );
      throw new ApiError('SERVICE_TROUBLE', 503);
    } else {
      // INITIAL, REG_PENDING (or no status yet): Applink has texted the person to confirm (reply
      // A). Not active, and not a failure: the subscriber notification settles it.
      log.info(
        { subscriber: maskAddress(user.subscriberId), status: status || 'none' },
        'register awaiting the subscriber’s SMS confirmation',
      );
      if (!(await settledSinceRequest())) {
        await stores.subscriptions.upsert(
          { subscriberId: user.subscriberId, status: status || 'INITIAL' },
          deps.now(),
        );
      }
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
    // Key the mirror, and any opt-out, by the id we stored, whichever form the notification used.
    const { id: subscriberId, user } = await resolveSubscriber(stores, data.subscriberId);
    const now = deps.now();

    if (!user) {
      // Stored and flagged, never unlocked: no account, no consent, no Register of ours.
      log.warn(
        { subscriber: maskAddress(subscriberId), status },
        'subscription notification for unknown subscriber',
      );
    }
    const settled = !PENDING_STATES.has(status);
    await stores.subscriptions.upsert(
      {
        subscriberId,
        ...(user ? { userId: user.id } : {}),
        status,
        ...(data.frequency ? { frequency: data.frequency } : {}),
        ...(settled ? { confirmedAt: now, confirmedBy: data.source ?? 'NOTIFICATION' } : {}),
      },
      now,
    );

    if (status === 'UNREGISTERED') {
      // Someone left through a channel we do not control: honour it like any other STOP.
      await stores.optOuts.suppress({ subscriberId, reason: 'STOP', source: 'NOTIFICATION' }, now);
    }
    log.info(
      { subscriber: maskAddress(subscriberId), status },
      'subscription notification applied',
    );
  }

  return { isPremium, view, subscribe, unsubscribe, handleNotification };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
