import {
  ApplinkError,
  ApplinkTransportError,
  generateExternalTrxId,
  maskAddress,
} from '@uposhom/applink-client';
import { ApiError } from '../errors.js';
import type { ServiceDeps } from '../services/deps.js';
import type { ChargeRecord, ChargeStatus, UserRecord } from '../stores/types.js';
import { covers, toPoisha } from './money.js';

export type CaasPurpose = 'SCAN' | 'DOCTOR_SUMMARY' | 'REPORT_EXPLAIN';

/** What the app sees. Internal states collapse onto the shared contract's six. */
export type PublicChargeStatus =
  'OTP_SENT' | 'PENDING' | 'SETTLED' | 'FAILED' | 'INSUFFICIENT_BALANCE' | 'EXPIRED';

const PUBLIC_STATUS: Record<ChargeStatus, PublicChargeStatus> = {
  PENDING: 'PENDING',
  OTP_SENT: 'OTP_SENT',
  PROCESSING: 'PENDING',
  PARTIAL: 'PENDING',
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  EXPIRED: 'EXPIRED',
};

export const OTP_LIFETIME_MS = 5 * 60 * 1000; // Applink OTPs are valid five minutes
export const MAX_CHARGE_OTP_ATTEMPTS = 5;
/** A charge stuck mid-flight for this long is failed and alerted for a human to check. */
export const STUCK_PROCESSING_MS = 2 * 60 * 60 * 1000;
/** Step 1 that never completed, or an OTP nobody used, is closed after this. Nothing was charged. */
export const OPEN_CHARGE_TTL_MS = 10 * 60 * 1000;

const CHARGE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

const TERMINAL: ReadonlySet<ChargeStatus> = new Set([
  'SETTLED',
  'FAILED',
  'INSUFFICIENT_BALANCE',
  'EXPIRED',
]);

function mapStartError(err: unknown): ApiError {
  if (err instanceof ApplinkError) {
    if (err.statusCode === 'E1326') return new ApiError('INSUFFICIENT_BALANCE', 402);
    if (err.statusCode === 'E1343') return new ApiError('NOT_ON_TEST_LIST', 403);
    if (err.statusCode === 'E1342') return new ApiError('NUMBER_BLOCKED', 403);
  }
  return new ApiError('PAYMENT_UNAVAILABLE', 503);
}

/**
 * Pay-per-use CaaS charging (Master Plan section 8, flow 15.6). It is two calls and a callback:
 *
 *   initiate -> ledger row (PENDING) -> /caas/direct/debit -> P1003, nothing charged, OTP sent
 *   verify   -> /caas/otp/verify with the requestCorrelator -> S1000 means SUBMITTED only
 *   charging notification -> the ONLY thing that settles the ledger and releases the entitlement
 *
 * Rules that cost money when broken:
 *   - the amount comes from server config keyed by purpose, never from the app;
 *   - the ledger row is written BEFORE Applink is called, with a fresh externalTrxId per payment;
 *   - P1003 is the expected answer of step 1 and is not success;
 *   - step 1 is never re-run to retry step 2; E1850 re-prompts the same charge; E1851 abandons it;
 *   - a timeout after step 2 is left PROCESSING, never retried: the notification decides;
 *   - fulfil only on statusCode S1000 with paidAmount covering the amount and balanceDue 0;
 *   - the entitlement is granted once per charge, whatever number of notifications arrive.
 */
export function createCaasService(deps: ServiceDeps) {
  const { stores, billing, log } = deps;

  async function initiate(
    user: UserRecord,
    input: { purpose: CaasPurpose; wording: string; ip: string },
  ) {
    if (!deps.applink || !user.subscriberId) throw new ApiError('PAYMENT_UNAVAILABLE', 503);
    const now = deps.now();

    // Each payment sends a paid OTP SMS: cap how fast one account can start them.
    const limited = await stores.rateLimit.hit(
      `caas:${user.id}`,
      CHARGE_LIMIT.limit,
      CHARGE_LIMIT.windowMs,
      now,
    );
    if (!limited.allowed) throw new ApiError('RATE_LIMITED', 429, limited.retryAfterSeconds);

    const amount = billing.caas[input.purpose].amount;
    const externalTrxId = generateExternalTrxId();

    // Consent for THIS payment, with the amount it disclosed, then the ledger row, then Applink.
    await stores.consents.record(
      {
        userId: user.id,
        kind: `CAAS_${input.purpose}_V1`,
        channel: 'APP',
        ip: input.ip,
        wording: input.wording,
        amount,
        currency: 'BDT',
      },
      now,
    );
    await stores.charges.create(
      {
        externalTrxId,
        userId: user.id,
        subscriberId: user.subscriberId,
        purpose: input.purpose,
        amount,
        currency: 'BDT',
      },
      now,
    );

    let res;
    try {
      res = await deps.applink.startCharge({
        subscriberId: user.subscriberId,
        amount,
        externalTrxId,
      });
    } catch (err) {
      if (err instanceof ApplinkTransportError) {
        // Step 1 charges nothing, so a timeout is safe to abandon. The reconciliation job closes
        // the row; if an OTP did go out the person simply asks for a new one.
        log.warn({ externalTrxId }, 'charge start outcome unknown after transport failure');
        throw new ApiError('PAYMENT_UNAVAILABLE', 503);
      }
      const code = (err as { statusCode?: string }).statusCode;
      await stores.charges.update(
        externalTrxId,
        { status: code === 'E1326' ? 'INSUFFICIENT_BALANCE' : 'FAILED' },
        deps.now(),
      );
      log.warn({ externalTrxId, statusCode: code }, 'charge start rejected');
      throw mapStartError(err);
    }

    // Assert the echoed transaction id before trusting anything else in the answer.
    if (res.externalTrxId !== undefined && res.externalTrxId !== externalTrxId) {
      await stores.charges.update(externalTrxId, { status: 'FAILED' }, deps.now());
      log.error({ externalTrxId }, 'charge start echoed a different externalTrxId');
      throw new ApiError('PAYMENT_UNAVAILABLE', 503);
    }
    // Without the correlator the charge can never be completed: do not leave the person waiting.
    if (!res.requestCorrelator) {
      await stores.charges.update(externalTrxId, { status: 'FAILED' }, deps.now());
      log.error({ externalTrxId }, 'charge start returned no requestCorrelator');
      throw new ApiError('PAYMENT_UNAVAILABLE', 503);
    }
    await stores.charges.update(
      externalTrxId,
      {
        status: 'OTP_SENT',
        requestCorrelator: res.requestCorrelator,
        ...(res.internalTrxId ? { internalTrxId: res.internalTrxId } : {}),
      },
      deps.now(),
    );
    return { chargeId: externalTrxId, amount, currency: 'BDT', status: 'OTP_SENT' as const };
  }

  async function ownCharge(user: UserRecord, chargeId: string): Promise<ChargeRecord> {
    const charge = await stores.charges.get(chargeId);
    // Someone else's charge looks exactly like a missing one.
    if (!charge || charge.userId !== user.id) throw new ApiError('CHARGE_NOT_FOUND', 404);
    return charge;
  }

  const result = (charge: ChargeRecord, code?: string) => ({
    chargeId: charge.externalTrxId,
    status: PUBLIC_STATUS[charge.status],
    ...(code ? { code } : {}),
  });

  async function verify(user: UserRecord, input: { chargeId: string; otp: string }) {
    if (!deps.applink) throw new ApiError('PAYMENT_UNAVAILABLE', 503);
    if (!/^\d{4,8}$/.test(input.otp)) throw new ApiError('INVALID_INPUT', 400);
    const charge = await ownCharge(user, input.chargeId);

    // Only an unspent OTP can be verified. Anything else just reports where the charge stands,
    // so a double tap can never submit a second charge.
    if (charge.status !== 'OTP_SENT') return result(charge);

    const now = deps.now();
    if (now.getTime() - charge.updatedAt.getTime() > OTP_LIFETIME_MS) {
      const expired = await stores.charges.update(charge.externalTrxId, { status: 'EXPIRED' }, now);
      return result(expired ?? charge);
    }
    const attempts = await stores.charges.incrementOtpAttempts(charge.externalTrxId);
    if (attempts > MAX_CHARGE_OTP_ATTEMPTS) {
      const expired = await stores.charges.update(charge.externalTrxId, { status: 'EXPIRED' }, now);
      return result(expired ?? charge);
    }
    if (!charge.requestCorrelator) throw new ApiError('PAYMENT_UNAVAILABLE', 503);

    try {
      await deps.applink.confirmCharge({
        requestCorrelator: charge.requestCorrelator,
        otp: input.otp,
        subscriberId: charge.subscriberId,
      });
    } catch (err) {
      if (err instanceof ApplinkTransportError) {
        // The debit may have been submitted. Never retry: the notification decides.
        const pending = await stores.charges.update(
          charge.externalTrxId,
          { status: 'PROCESSING' },
          deps.now(),
        );
        log.warn({ externalTrxId: charge.externalTrxId }, 'charge verify outcome unknown');
        return result(pending ?? charge);
      }
      const code = (err as { statusCode?: string }).statusCode;
      if (code === 'E1850') return result(charge, 'OTP_WRONG'); // re-prompt the SAME charge
      const terminal: ChargeStatus | null =
        code === 'E1851' ? 'EXPIRED' : code === 'E1326' ? 'INSUFFICIENT_BALANCE' : null;
      if (terminal) {
        const done = await stores.charges.update(
          charge.externalTrxId,
          { status: terminal },
          deps.now(),
        );
        return result(done ?? charge);
      }
      if (code === 'E1337') {
        // Duplicate: Applink already has it. Resolve from the notification.
        const pending = await stores.charges.update(
          charge.externalTrxId,
          { status: 'PROCESSING' },
          deps.now(),
        );
        return result(pending ?? charge);
      }
      const failed = await stores.charges.update(
        charge.externalTrxId,
        { status: 'FAILED' },
        deps.now(),
      );
      log.warn({ externalTrxId: charge.externalTrxId, statusCode: code }, 'charge verify rejected');
      return result(failed ?? charge);
    }

    // S1000 only means the debit was SUBMITTED. It is not settled until the notification says so.
    const submitted = await stores.charges.update(
      charge.externalTrxId,
      { status: 'PROCESSING' },
      deps.now(),
    );
    return result(submitted ?? charge);
  }

  async function status(user: UserRecord, chargeId: string) {
    return result(await ownCharge(user, chargeId));
  }

  /**
   * The charging notification: the only thing that settles a charge. Safe against duplicates,
   * partial payments, out-of-order delivery and notifications for charges we never started.
   */
  async function handleNotification(data: {
    externalTrxId: string;
    statusCode: string;
    statusDetail?: string | undefined;
    internalTrxId?: string | undefined;
    paidAmount?: string | undefined;
    balanceDue?: string | undefined;
    referenceId?: string | undefined;
  }): Promise<void> {
    const charge = await stores.charges.get(data.externalTrxId);
    if (!charge) {
      // Not a charge we started: acknowledged and discarded (Applink signs nothing).
      log.warn({ externalTrxId: data.externalTrxId }, 'charging notification matches no charge');
      return;
    }
    // A late or repeated notification never undoes a final state.
    if (TERMINAL.has(charge.status)) {
      log.info(
        { externalTrxId: charge.externalTrxId, status: charge.status },
        'charging notification ignored: charge is final',
      );
      return;
    }

    const now = deps.now();
    const common = {
      ...(data.internalTrxId ? { internalTrxId: data.internalTrxId } : {}),
      ...(data.referenceId ? { referenceId: data.referenceId } : {}),
      ...(data.paidAmount !== undefined ? { paidAmount: data.paidAmount } : {}),
      ...(data.balanceDue !== undefined ? { balanceDue: data.balanceDue } : {}),
    };
    const code = data.statusCode.trim().toUpperCase();

    if (code === 'S1000') {
      // Fulfil only when the money covers the price AND nothing is still owed.
      const owed = data.balanceDue === undefined ? 0 : toPoisha(data.balanceDue);
      const settled = covers(data.paidAmount, charge.amount) && owed === 0;
      if (!settled) {
        await stores.charges.update(charge.externalTrxId, { status: 'PARTIAL', ...common }, now);
        log.info({ externalTrxId: charge.externalTrxId }, 'charging notification: paid in part');
        return;
      }
      await stores.charges.update(
        charge.externalTrxId,
        { status: 'SETTLED', fulfilledAt: now, ...common },
        now,
      );
      const grant = billing.grants[charge.purpose as CaasPurpose];
      if (grant) {
        // Idempotent on the charge: a replay cannot grant a second credit.
        await stores.entitlements.grant(
          {
            userId: charge.userId,
            feature: grant.feature,
            quantity: grant.quantity,
            chargeId: charge.externalTrxId,
          },
          now,
        );
      }
      log.info(
        { externalTrxId: charge.externalTrxId, subscriber: maskAddress(charge.subscriberId) },
        'charge settled',
      );
      return;
    }

    if (code.startsWith('P')) {
      await stores.charges.update(charge.externalTrxId, { status: 'PARTIAL', ...common }, now);
      return;
    }
    // E-prefixed (or anything else): recorded, never fulfilled.
    await stores.charges.update(
      charge.externalTrxId,
      { status: code === 'E1326' ? 'INSUFFICIENT_BALANCE' : 'FAILED', ...common },
      now,
    );
    log.warn(
      { externalTrxId: charge.externalTrxId, statusCode: code },
      'charging notification: charge failed',
    );
  }

  /**
   * Resolves charges that never reached a notification (run on a schedule):
   *  - step 1 never completed, or the OTP went unused: closed as EXPIRED. Nothing was charged,
   *    because no OTP was ever verified.
   *  - verified but no notification for hours: failed and alerted for a human to check with
   *    Applink, because money may have moved. Never fulfilled without a notification.
   */
  async function reconcile(): Promise<{ expired: number; stuck: number }> {
    const now = deps.now();
    let expired = 0;
    let stuck = 0;

    const open = await stores.charges.listOpen(new Date(now.getTime() - OPEN_CHARGE_TTL_MS), 200);
    for (const c of open) {
      if (c.status === 'PENDING' || c.status === 'OTP_SENT') {
        await stores.charges.update(c.externalTrxId, { status: 'EXPIRED' }, now);
        expired++;
      }
    }
    const processing = await stores.charges.listOpen(
      new Date(now.getTime() - STUCK_PROCESSING_MS),
      200,
    );
    for (const c of processing) {
      if (c.status === 'PROCESSING' || c.status === 'PARTIAL') {
        await stores.charges.update(c.externalTrxId, { status: 'FAILED' }, now);
        log.error(
          { externalTrxId: c.externalTrxId, internalTrxId: c.internalTrxId, alert: 'charge-stuck' },
          'charge submitted but never confirmed: check with Applink before refunding or granting',
        );
        deps.alerts.alert(`charge-stuck ${c.externalTrxId}`, {
          internalTrxId: c.internalTrxId ?? 'none',
        });
        stuck++;
      }
    }
    return { expired, stuck };
  }

  return { initiate, verify, status, handleNotification, reconcile };
}

export type CaasService = ReturnType<typeof createCaasService>;
