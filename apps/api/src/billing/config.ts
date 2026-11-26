import type { SubscriptionPlan } from '../stores/types.js';

/**
 * Prices and caps. These are CONFIG, not code: the plan decides them with the mentor on Day 5
 * (Master Plan section 9), so every figure can be changed from the environment without a deploy
 * of new code. The defaults below are placeholders taken from the plan's examples.
 *
 * Amounts are decimal BDT strings and come only from here, keyed by feature: the app sends a
 * purpose, never an amount, and what it shows on the payment sheet must equal what is charged.
 */
export interface BillingConfig {
  plans: Record<SubscriptionPlan, { amount: string; currency: 'BDT'; frequency: 'monthly' }>;
  /** One-off CaaS charges, keyed by purpose. */
  caas: Record<'SCAN' | 'DOCTOR_SUMMARY' | 'REPORT_EXPLAIN', { amount: string }>;
  /** Monthly allowances. */
  limits: {
    free: { scans: number; sms: number };
    premium: { scans: number; sms: number };
  };
  /** What a settled one-off charge grants: how many credits of which feature. */
  grants: Record<
    'SCAN' | 'DOCTOR_SUMMARY' | 'REPORT_EXPLAIN',
    { feature: string; quantity: number }
  >;
}

export const DEFAULT_BILLING: BillingConfig = {
  plans: {
    FAMILY_CIRCLE: { amount: '30.00', currency: 'BDT', frequency: 'monthly' },
    PHARMACY: { amount: '30.00', currency: 'BDT', frequency: 'monthly' },
  },
  caas: {
    SCAN: { amount: '5.00' },
    DOCTOR_SUMMARY: { amount: '2.00' },
    REPORT_EXPLAIN: { amount: '5.00' },
  },
  limits: {
    free: { scans: 5, sms: 30 },
    premium: { scans: 100, sms: 500 },
  },
  grants: {
    SCAN: { feature: 'SCAN', quantity: 1 },
    DOCTOR_SUMMARY: { feature: 'DOCTOR_SUMMARY', quantity: 1 },
    REPORT_EXPLAIN: { feature: 'REPORT_EXPLAIN', quantity: 1 },
  },
};

/** Environment variables that override the defaults. Unset or empty keeps the default. */
export interface BillingEnv {
  PLAN_FAMILY_CIRCLE_AMOUNT?: string | undefined;
  PLAN_PHARMACY_AMOUNT?: string | undefined;
  CAAS_AMOUNT_SCAN?: string | undefined;
  CAAS_AMOUNT_DOCTOR_SUMMARY?: string | undefined;
  CAAS_AMOUNT_REPORT_EXPLAIN?: string | undefined;
  FREE_SCANS_PER_MONTH?: number | undefined;
  FREE_SMS_PER_MONTH?: number | undefined;
  PREMIUM_SCANS_PER_MONTH?: number | undefined;
  PREMIUM_SMS_PER_MONTH?: number | undefined;
}

export function billingFromEnv(env: BillingEnv): BillingConfig {
  const d = DEFAULT_BILLING;
  return {
    plans: {
      FAMILY_CIRCLE: {
        ...d.plans.FAMILY_CIRCLE,
        amount: env.PLAN_FAMILY_CIRCLE_AMOUNT ?? d.plans.FAMILY_CIRCLE.amount,
      },
      PHARMACY: {
        ...d.plans.PHARMACY,
        amount: env.PLAN_PHARMACY_AMOUNT ?? d.plans.PHARMACY.amount,
      },
    },
    caas: {
      SCAN: { amount: env.CAAS_AMOUNT_SCAN ?? d.caas.SCAN.amount },
      DOCTOR_SUMMARY: { amount: env.CAAS_AMOUNT_DOCTOR_SUMMARY ?? d.caas.DOCTOR_SUMMARY.amount },
      REPORT_EXPLAIN: { amount: env.CAAS_AMOUNT_REPORT_EXPLAIN ?? d.caas.REPORT_EXPLAIN.amount },
    },
    limits: {
      free: {
        scans: env.FREE_SCANS_PER_MONTH ?? d.limits.free.scans,
        sms: env.FREE_SMS_PER_MONTH ?? d.limits.free.sms,
      },
      premium: {
        scans: env.PREMIUM_SCANS_PER_MONTH ?? d.limits.premium.scans,
        sms: env.PREMIUM_SMS_PER_MONTH ?? d.limits.premium.sms,
      },
    },
    grants: d.grants,
  };
}

/** The consent kind recorded for a plan. Part of the Premium gate. */
export const planConsentKind = (plan: SubscriptionPlan): string => `${plan}_V1`;

/** Monthly counters roll over at the start of the month in Bangladesh, not UTC. */
export function usagePeriod(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}
