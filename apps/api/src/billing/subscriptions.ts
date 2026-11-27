import { maskAddress } from '@uposhom/applink-client';
import { ApiError } from '../errors.js';
import type { ServiceDeps } from '../services/deps.js';
import type { UnregisterService } from '../subscription/unregister.js';
import type { SubscriptionPlan, SubscriptionRecord, UserRecord } from '../stores/types.js';
import { resolveSubscriber } from '../sms/identity.js';
import { planConsentKind } from './config.js';

/** Only these two mean the subscriber can use the service. */
export const ACTIVE_STATES = new Set(['REGISTERED', 'TRIAL']);

/**
 * Applink accepted the request and is still waiting on the subscriber or on billing.
 * PENDING CONFIRMATION is what live Applink sometimes answers while it waits for the subscriber.
 */
const PENDING_STATES = new Set(['INITIAL', 'REG_PENDING', 'PENDING CONFIRMATION']);

/**
 * How long a request may sit unconfirmed before we stop calling it pending and let the person ask
 * again (Applink's own confirmation window).
 */
export const CONFIRM_WINDOW_MS = 60 * 60 * 1000;

/** A billing failure, not a step on the way to active. */
const BLOCKED_STATES = new Set(['TEMPORARY_BLOCKED', 'BLOCKED']);

/**
 * True while our subscription request is waiting for Applink to settle: we asked recently, the
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

/**
 * The Applink OTP API as the subscription flow uses it (docs/otp). Request sends the code to the
 * subscriber's phone; verify checks it and, in Applink's words, activates the subscription.
 */
export interface SubscriptionOtp {
  request(input: {
    userId: string;
    ip: string;
  }): Promise<{ maskedPhone: string; expiresInSeconds: number }>;
  verify(input: {
    userId: string;
    otp: string;
  }): Promise<{ subscriberId: string | null; subscriptionStatus: string | null }>;
}

export const planFor = (user: UserRecord): SubscriptionPlan =>
  user.accountType === 'PHARMACY' ? 'PHARMACY' : 'FAMILY_CIRCLE';

const normaliseStatus = (status: string | null | undefined): string =>
  (status ?? '').trim().toUpperCase().replace(/\.$/, '');

/**
 * Premium subscriptions (Family Circle and the pharmacy plan), following Applink's documented flow:
 *
 *   1. requestOtp  : the consent is recorded, then Applink sends an OTP to the subscriber.
 *   2. verifyOtp   : the subscriber enters it; Applink verifies it and answers with the
 *                    subscriptionStatus (INITIAL or REGISTERED). REGISTERED is final. INITIAL means
 *                    the request is not complete yet, so the subscription call (Register) follows
 *                    once, as Applink advised.
 *
 * The Premium gate (Master Plan section 8) is ALL of:
 *   1. an active subscriptions_mirror row for the user's subscriber id (REGISTERED or TRIAL),
 *   2. a recorded consent row for the plan, and
 *   3. a plan OTP verification that WE asked for (registerRequestedAt).
 * `/otp/verify` also returns REGISTERED at free sign-up, so an active status alone never unlocks
 * anything. A notification is not authorisation either: it only updates the mirror.
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
    // Cancelled only when the stop came after our request, not when a request simply was never
    // confirmed.
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
   * Step 1. The consent row (wording, amount, currency, frequency, channel, IP) is written BEFORE
   * the OTP goes out, because verifying it activates the subscription at Applink.
   */
  async function requestOtp(
    user: UserRecord,
    input: { wording: string; ip: string },
    otp: SubscriptionOtp,
  ): Promise<{ maskedPhone: string; expiresInSeconds: number }> {
    if (!user.subscriberId || !deps.applink) throw new ApiError('SERVICE_TROUBLE', 503);

    const plan = planFor(user);
    const price = billing.plans[plan];
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
      deps.now(),
    );
    return otp.request({ userId: user.id, ip: input.ip });
  }

  /**
   * Step 2. Applink verifies the code and answers with the subscription status. REGISTERED (or
   * TRIAL) activates the plan now. INITIAL means Applink has not completed the request, so the
   * subscription call (Register) is made once to finish it. If the plan is still pending after
   * that (or verify said REG_PENDING), one status lookup, then the notification or the nightly
   * sweep, settles it. The OTP call is never retried blindly: a wrong code costs an attempt, not a
   * second SMS.
   */
  async function verifyOtp(
    user: UserRecord,
    code: string,
    otp: SubscriptionOtp,
  ): Promise<SubscriptionView> {
    const subscriberId = user.subscriberId;
    if (!subscriberId) throw new ApiError('SERVICE_TROUBLE', 503);

    const plan = planFor(user);
    const price = billing.plans[plan];
    const startedAt = deps.now();
    const verified = await otp.verify({ userId: user.id, otp: code });
    const status = normaliseStatus(verified.subscriptionStatus) || 'INITIAL';

    if (BLOCKED_STATES.has(status)) {
      // A billing block: the subscription cannot take effect now. Record it, but do not mark the
      // plan as requested, so a number that was already REGISTERED stays out of Premium.
      log.warn(
        { subscriber: maskAddress(subscriberId), status },
        'subscription otp verify blocked',
      );
      await stores.subscriptions.upsert({ subscriberId, status }, deps.now());
      throw new ApiError('SERVICE_TROUBLE', 503);
    }
    if (!ACTIVE_STATES.has(status) && !PENDING_STATES.has(status)) {
      log.warn(
        { subscriber: maskAddress(subscriberId), status },
        'subscription otp verify returned an unexpected status',
      );
      throw new ApiError('SERVICE_TROUBLE', 503);
    }

    // Fresh, recorded consent and a proven phone are what allow a person who said STOP to be
    // subscribed again.
    await stores.optOuts.clearStop(subscriberId);

    // A notification can arrive while verify is in flight: never overwrite its final status with a
    // stale pending one.
    const current = await stores.subscriptions.get(subscriberId);
    const settledSinceRequest = Boolean(
      current &&
      current.lastConfirmedAt &&
      current.lastConfirmedAt >= startedAt &&
      !PENDING_STATES.has(current.status),
    );
    const active = ACTIVE_STATES.has(status);
    await stores.subscriptions.upsert(
      {
        subscriberId,
        userId: user.id,
        plan,
        registerRequestedAt: startedAt,
        ...(settledSinceRequest
          ? {}
          : {
              status,
              frequency: price.frequency,
              ...(active ? { confirmedAt: deps.now(), confirmedBy: 'OTP_VERIFY' as const } : {}),
            }),
      },
      deps.now(),
    );
    log.info(
      { subscriber: maskAddress(subscriberId), status },
      'subscription otp verified: applink answered',
    );

    if (!active && !settledSinceRequest) {
      // INITIAL: Applink has the request but has not completed it (live Applink leaves it there
      // after the OTP), so the subscription call finishes it. REG_PENDING already has its charging
      // request out, so it only waits.
      const registered =
        status === 'INITIAL' && (await registerOnce(subscriberId, price.frequency));
      if (!registered) await reconcileNow(subscriberId);
    }
    return view(user);
  }

  /**
   * The OTP is verified and Applink still says INITIAL: call the subscription API (Register,
   * /subscription/send action 1) exactly once, as Applink advised. Never retried blindly: a timeout
   * does not mean it failed, so the notification or the sweep settles it. Returns true when the
   * plan is now active. A failure here is not the person's failure (their code was right): the plan
   * stays pending. A billing block is a failure and Premium stays shut.
   */
  async function registerOnce(subscriberId: string, frequency: string): Promise<boolean> {
    if (!deps.applink) return false;
    let answered: string;
    try {
      const res = await deps.applink.register(subscriberId);
      answered = normaliseStatus(res.subscriptionStatus);
    } catch (err) {
      log.warn(
        {
          subscriber: maskAddress(subscriberId),
          statusCode: (err as { statusCode?: string }).statusCode ?? 'transport',
        },
        'subscription register after otp failed: staying pending',
      );
      return false;
    }
    log.info(
      { subscriber: maskAddress(subscriberId), status: answered || 'none' },
      'subscription register after otp: applink answered',
    );

    if (BLOCKED_STATES.has(answered)) {
      await stores.subscriptions.upsert({ subscriberId, status: answered }, deps.now());
      throw new ApiError('SERVICE_TROUBLE', 503);
    }
    if (!ACTIVE_STATES.has(answered)) return false; // still pending (for example PENDING CONFIRMATION)

    await stores.subscriptions.upsert(
      {
        subscriberId,
        status: answered,
        frequency,
        confirmedAt: deps.now(),
        confirmedBy: 'REGISTER_RESPONSE',
      },
      deps.now(),
    );
    return true;
  }

  /**
   * One status lookup (getSubscriberChargingInfo) when the plan is still pending, so a plan that
   * Applink has already settled does not wait for the nightly sweep. Best effort: if it fails the
   * notification or the sweep settles it. UNREGISTERED is never applied from here.
   */
  async function reconcileNow(subscriberId: string): Promise<void> {
    if (!deps.applink) return;
    try {
      const res = await deps.applink.getSubscriberChargingInfo([subscriberId]);
      const entry = (res.subscriberInfo ?? res.destinationResponses ?? [])[0];
      const status = normaliseStatus(entry?.subscriptionStatus);
      log.info(
        {
          subscriber: maskAddress(subscriberId),
          status: status || 'none',
          statusCode: entry?.statusCode ?? res.statusCode,
        },
        'subscription status lookup: applink answered',
      );
      if (!status || (entry?.statusCode && entry.statusCode !== 'S1000')) return;
      if (
        !ACTIVE_STATES.has(status) &&
        !PENDING_STATES.has(status) &&
        !BLOCKED_STATES.has(status)
      ) {
        return;
      }
      await handleNotification({ subscriberId, status, source: 'SWEEP' });
    } catch (err) {
      log.warn(
        {
          subscriber: maskAddress(subscriberId),
          statusCode: (err as { statusCode?: string }).statusCode ?? 'transport',
        },
        'subscription status lookup failed: the notification or the sweep will settle it',
      );
    }
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
    /** NOTIFICATION from the callback, SWEEP from a status lookup (nightly or right after verify). */
    source?: 'NOTIFICATION' | 'SWEEP';
  }): Promise<void> {
    const status = data.status.trim().toUpperCase().replace(/\.$/, '');
    // Key the mirror, and any opt-out, by the id we stored, whichever form the notification used.
    const { id: subscriberId, user } = await resolveSubscriber(stores, data.subscriberId);
    const now = deps.now();

    if (!user) {
      // Stored and flagged, never unlocked: no account, no consent, no request of ours.
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

  return { isPremium, view, requestOtp, verifyOtp, unsubscribe, handleNotification };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
