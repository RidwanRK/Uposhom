import { randomUUID } from 'node:crypto';
import { toTelAddress } from './address.js';
import {
  ApplinkError,
  ApplinkNotConfiguredError,
  ApplinkTransportError,
  PENDING_CODES,
} from './errors.js';
import type {
  ApplinkBaseResponse,
  ApplinkClientConfig,
  CaasOtpGenerationResponse,
  CaasOtpVerifyResponse,
  OtpApplicationMetaData,
  OtpRequestResponse,
  OtpVerifyResponse,
  QueryBaseResponse,
  ServiceName,
  SmsEncoding,
  SmsSendResponse,
  SubscriberChargingInfoResponse,
  SubscriptionSendResponse,
} from './types.js';

const API_VERSION = '1.0';
const CURRENCY = 'BDT';
const DEFAULT_TIMEOUT_MS = 10_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A unique, persistable idempotency key for a charge. */
export function generateExternalTrxId(): string {
  return randomUUID().replace(/-/g, '');
}

/** Money crosses the wire as a decimal string with two places ("5.00"). Rejects zero and sub-poisha. */
export function formatAmount(amount: string): string {
  const trimmed = amount.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match || /^0+(\.0+)?$/.test(trimmed)) {
    throw new Error(`[applink] amount must be a positive decimal string such as "5.00"`);
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

/** The published samples include a trailing dot ("UNREGISTERED."), hence the prefix comparison. */
export function hasSubscriptionStatus(
  response: SubscriptionSendResponse,
  expected: 'REGISTERED' | 'UNREGISTERED',
): boolean {
  return (response.subscriptionStatus ?? '').trim().toUpperCase().startsWith(expected);
}

export interface SendSmsOptions {
  /** Must be a provisioned alias, or the send fails E1331. Omit otherwise. */
  sourceAddress?: string;
  /** "1" requests a delivery report on the report callback. */
  deliveryStatusRequest?: '0' | '1';
  encoding?: SmsEncoding;
}

export type ApplinkClient = ReturnType<typeof createApplinkClient>;

/**
 * One `post()` injects credentials, applies a timeout and turns any non-S1000 answer into an
 * ApplinkError. Each service is a thin wrapper that resolves its endpoint first, so calling an API
 * that is not enabled fails locally instead of as E1309.
 *
 * No wrapper retries internally. Money-moving and message-sending calls are never blindly retried
 * after a timeout: a timeout does not mean the request failed. Callers reconcile instead.
 */
export function createApplinkClient(config: ApplinkClientConfig) {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function endpoint(service: ServiceName): string {
    const url = config.endpoints[service]?.trim();
    if (!url) throw new ApplinkNotConfiguredError(service);
    return url;
  }

  async function post<T extends ApplinkBaseResponse>(
    service: string,
    url: string,
    body: Record<string, unknown>,
    acceptedCodes: readonly string[] = [],
  ): Promise<T> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !LOOPBACK.has(parsed.hostname)) {
      throw new ApplinkTransportError(
        'endpoint is not HTTPS; plain HTTP is only allowed to a local mock',
        service,
      );
    }

    let text: string;
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        body: JSON.stringify({
          applicationId: config.applicationId,
          password: config.password,
          ...body,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      throw new ApplinkTransportError(
        timedOut ? `timed out after ${timeoutMs}ms` : 'request failed',
        service,
      );
    }

    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new ApplinkTransportError('response was not JSON', service);
    }

    if (data.statusCode === 'S1000' || acceptedCodes.includes(data.statusCode)) return data;
    const error = new ApplinkError(
      String(data.statusCode),
      String(data.statusDetail ?? ''),
      service,
    );
    try {
      config.onError?.(error);
    } catch {
      // A broken monitor must never change what the caller sees.
    }
    throw error;
  }

  return {
    /* SMS */
    sendSms(to: string | string[], message: string, options: SendSmsOptions = {}) {
      const recipients = (Array.isArray(to) ? to : [to]).map(toTelAddress);
      if (recipients.includes('tel:all')) {
        throw new Error('[applink] tel:all is not supported by this client');
      }
      return post<SmsSendResponse>('sms-send', endpoint('smsSend'), {
        version: API_VERSION,
        message,
        destinationAddresses: recipients,
        ...options,
      });
    },

    /*
     * Subscription. Register only with recorded consent.
     *
     * E1338 is not a failure: live Applink answers a Register that worked with E1338 "User
     * confirmation required for subscription." and subscriptionStatus "PENDING CONFIRMATION", then
     * texts the person to reply A. The caller reads subscriptionStatus, as on S1000.
     */
    register(subscriberId: string) {
      return post<SubscriptionSendResponse>(
        'subscription-register',
        endpoint('subscriptionSend'),
        { subscriberId: toTelAddress(subscriberId), action: '1' },
        ['E1338'],
      );
    },

    unregister(subscriberId: string) {
      return post<SubscriptionSendResponse>(
        'subscription-unregister',
        endpoint('subscriptionSend'),
        { subscriberId: toTelAddress(subscriberId), action: '0' },
      );
    },

    /** Needs no subscriber and charges nothing: the credential, provisioning and egress-IP smoke test. */
    async queryBase(): Promise<QueryBaseResponse & { size: number }> {
      const res = await post<QueryBaseResponse>(
        'subscription-query-base',
        endpoint('subscriptionQueryBase'),
        {},
      );
      return { ...res, size: Number.parseInt(String(res.baseSize ?? '0'), 10) };
    },

    /** Status lookup for up to ten subscribers. For the nightly sweep, not a per-request gate. */
    getSubscriberChargingInfo(subscriberIds: string[]) {
      if (subscriberIds.length === 0 || subscriberIds.length > 10) {
        throw new Error('[applink] getSubscriberChargingInfo takes 1 to 10 subscribers');
      }
      return post<SubscriberChargingInfoResponse>(
        'subscription-charging-info',
        endpoint('subscriptionChargingInfo'),
        { subscriberIds: subscriberIds.map(toTelAddress) },
      );
    },

    /* OTP. Rate-limit per number and per IP before calling. Keep referenceNo server-side. */
    requestOtp(input: {
      subscriberId: string;
      applicationHash?: string;
      metaData?: OtpApplicationMetaData;
    }) {
      return post<OtpRequestResponse>('otp-request', endpoint('otpRequest'), {
        subscriberId: toTelAddress(input.subscriberId),
        ...(input.applicationHash ? { applicationHash: input.applicationHash } : {}),
        ...(input.metaData ? { applicationMetaData: input.metaData } : {}),
      });
    },

    verifyOtp(input: { referenceNo: string; otp: string }) {
      return post<OtpVerifyResponse>('otp-verify', endpoint('otpVerify'), {
        referenceNo: input.referenceNo,
        otp: input.otp,
      });
    },

    /**
     * CaaS step 1. DOES NOT CHARGE ANYONE: returns P1003 plus the requestCorrelator step 2 needs.
     * Persist externalTrxId in a PENDING ledger row first, and persist requestCorrelator after.
     */
    startCharge(input: {
      subscriberId: string;
      amount: string;
      externalTrxId: string;
      paymentInstrumentName?: string;
    }) {
      if (!input.externalTrxId) {
        throw new Error('[applink] externalTrxId is required and must be persisted first');
      }
      return post<CaasOtpGenerationResponse>(
        'caas-otp-generation',
        endpoint('caasOtpGeneration'),
        {
          externalTrxId: input.externalTrxId,
          amount: formatAmount(input.amount),
          paymentInstrumentName: input.paymentInstrumentName ?? 'Mobile Account',
          subscriberId: toTelAddress(input.subscriberId),
          Currency: CURRENCY, // capital C on this endpoint, as published
        },
        PENDING_CODES,
      );
    },

    /**
     * CaaS step 2. THIS MOVES REAL MONEY. referenceNo is the requestCorrelator from step 1. Never
     * call startCharge again to retry it. The charging notification is what settles the ledger.
     */
    confirmCharge(input: { requestCorrelator: string; otp: string; subscriberId: string }) {
      if (!input.requestCorrelator) {
        throw new Error('[applink] requestCorrelator is required (from the startCharge response)');
      }
      return post<CaasOtpVerifyResponse>('caas-otp-verify', endpoint('caasOtpVerify'), {
        referenceNo: input.requestCorrelator,
        otp: input.otp,
        sourceAddress: toTelAddress(input.subscriberId),
      });
    },
  };
}
