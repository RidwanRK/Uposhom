/**
 * Applink response shapes, following the published contract. Applink sends numbers as strings
 * (baseSize, amount, paidAmount): types reflect the wire, parse at the boundary.
 */

export interface ApplinkBaseResponse {
  statusCode: string;
  statusDetail: string;
  version?: string;
  requestId?: string;
}

export type SmsEncoding = '0' | '240' | '245';

export interface SmsDestinationResponse {
  timeStamp?: string;
  address?: string;
  messageId?: string;
  /** Outcome for this recipient alone. Branch on it, not only on the top level. */
  statusCode?: string;
  statusDetail?: string;
}

export interface SmsSendResponse extends ApplinkBaseResponse {
  destinationResponses?: SmsDestinationResponse[];
}

export interface SubscriptionSendResponse extends ApplinkBaseResponse {
  /** The outcome. Applink has no "already registered" code, so read this, not statusCode. */
  subscriptionStatus?: string;
}

export interface QueryBaseResponse extends ApplinkBaseResponse {
  baseSize?: string;
}

export type SubscriptionStatus =
  'INITIAL' | 'REG_PENDING' | 'TRIAL' | 'REGISTERED' | 'UNREGISTERED' | 'TEMPORARY_BLOCKED';

export interface SubscriberChargingInfo {
  subscriberId: string;
  subscriptionStatus?: SubscriptionStatus;
  lastChargedDate?: string;
  lastChargedAmount?: string;
  numberType?: string;
  statusCode?: string;
  statusDetail?: string;
}

export interface SubscriberChargingInfoResponse extends ApplinkBaseResponse {
  destinationResponses?: SubscriberChargingInfo[];
}

export interface OtpApplicationMetaData {
  client: string;
  device: string;
  os: string;
  appCode: string;
}

export interface OtpRequestResponse extends ApplinkBaseResponse {
  /** Keep server-side. Never send it to the app. */
  referenceNo?: string;
}

export interface OtpVerifyResponse extends ApplinkBaseResponse {
  subscriptionStatus?: string;
  /** Opaque, possibly masked. The join key for every later call and callback. */
  subscriberId?: string;
}

export interface CaasOtpGenerationResponse extends ApplinkBaseResponse {
  timeStamp?: string;
  externalTrxId?: string;
  /** Step 2 needs this as referenceNo. Persist it: the charge cannot be completed without it. */
  requestCorrelator?: string;
  internalTrxId?: string;
}

/** The published sample echoes the request; read statusCode and settle from the notification. */
export interface CaasOtpVerifyResponse extends ApplinkBaseResponse {
  [key: string]: unknown;
}

import type { ApplinkError } from './errors.js';

/** Endpoint variables Applink services are reached through. Unset means the API is not enabled. */
export type ServiceName =
  | 'smsSend'
  | 'subscriptionSend'
  | 'subscriptionQueryBase'
  | 'subscriptionChargingInfo'
  | 'otpRequest'
  | 'otpVerify'
  | 'caasOtpGeneration'
  | 'caasOtpVerify';

export interface ApplinkClientConfig {
  /** Never log these. Never send them to a client. */
  applicationId: string;
  password: string;
  endpoints: Partial<Record<ServiceName, string>>;
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Per-call timeout. Defaults to 10 seconds (Master Plan section 8). */
  timeoutMs?: number;
  /**
   * Called with every ApplinkError just before it is thrown. For monitoring: a configuration-class
   * error (E1303, E1313, E1309...) means the integration is down and should raise an alert.
   */
  onError?: (err: ApplinkError) => void;
}
