import { z } from 'zod';

export const subscriptionStatusResponse = z.object({
  status: z.enum(['INACTIVE', 'PENDING', 'ACTIVE', 'CANCELLED']),
  plan: z.enum(['FAMILY_CIRCLE', 'PHARMACY']).optional(),
  amount: z.string().optional(), // '30.00'
  currency: z.string().optional(),
  lastConfirmedAt: z.string().nullable().optional(),
});
export type SubscriptionStatusResponse = z.infer<typeof subscriptionStatusResponse>;

export const subscribeBody = z.object({
  consentAccepted: z.literal(true),
  /** Exact wording shown on screen, stored as consent evidence. */
  consentWording: z.string(),
});

export const caasPurpose = z.enum(['SCAN', 'DOCTOR_SUMMARY', 'REPORT_EXPLAIN']);
export type CaasPurpose = z.infer<typeof caasPurpose>;

export const caasInitiateBody = z.object({ purpose: caasPurpose, consentWording: z.string() });
export const caasInitiateResponse = z.object({
  chargeId: z.string(),
  amount: z.string(), // '5.00' (server-side, equal to what was disclosed)
  currency: z.string(),
  status: z.literal('OTP_SENT'),
});
export type CaasInitiateResponse = z.infer<typeof caasInitiateResponse>;

export const caasVerifyBody = z.object({ chargeId: z.string(), otp: z.string() });
export const caasStatus = z.enum([
  'OTP_SENT',
  'PENDING',
  'SETTLED',
  'FAILED',
  'INSUFFICIENT_BALANCE',
  'EXPIRED',
]);
export type CaasStatus = z.infer<typeof caasStatus>;
export const caasVerifyResponse = z.object({
  chargeId: z.string(),
  status: caasStatus,
  /** 'OTP_WRONG' lets the user retry on the same request. */
  code: z.string().optional(),
});
export type CaasVerifyResponse = z.infer<typeof caasVerifyResponse>;

export const entitlementsResponse = z.object({
  tier: z.enum(['FREE', 'PREMIUM']),
  scans: z.object({ used: z.number(), limit: z.number() }),
  sms: z.object({ used: z.number(), limit: z.number() }),
  doctorSummaryCredits: z.number().optional(),
  features: z.array(z.string()).optional(),
});
export type EntitlementsResponse = z.infer<typeof entitlementsResponse>;
