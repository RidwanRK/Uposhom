import { ApiError } from '../errors.js';
import type { ServiceDeps } from '../services/deps.js';
import type { UserRecord } from '../stores/types.js';
import { usagePeriod } from './config.js';
import type { SubscriptionService } from './subscriptions.js';

export type Feature = 'SCAN' | 'DOCTOR_SUMMARY' | 'REPORT_EXPLAIN';

export interface EntitlementsView {
  tier: 'FREE' | 'PREMIUM';
  scans: { used: number; limit: number };
  sms: { used: number; limit: number };
  doctorSummaryCredits: number;
  features: string[];
}

export type UseResult =
  | { allowed: true; via: 'QUOTA' | 'PREMIUM' | 'CREDIT' }
  | {
      allowed: false;
      reason: 'QUOTA_EXCEEDED';
      payWith: { purpose: Feature; amount: string; currency: 'BDT' };
    };

const PREMIUM_FEATURES = [
  'DEPENDENTS_6',
  'PRIORITY_SMS',
  'CAREGIVER_ESCALATION',
  'UNLIMITED_STORAGE',
  'ANALYTICS',
  'DOCTOR_SUMMARY',
];

/** Features a Premium subscription includes without paying per use. */
const PREMIUM_INCLUDES = new Set<Feature>(['DOCTOR_SUMMARY', 'REPORT_EXPLAIN']);

/**
 * Free and Premium allowances and paid credits. Everything reads the local mirror and counters:
 * no Applink call. Other workstreams call `useScan`, `useSms` and `useFeature` before doing the
 * work, and tell the person to pay per use (CaaS) when the answer is QUOTA_EXCEEDED.
 */
export function createEntitlementService(deps: ServiceDeps, subs: SubscriptionService) {
  const { stores, billing } = deps;

  async function userById(userId: string): Promise<UserRecord> {
    const user = await stores.users.findById(userId);
    if (!user) throw new ApiError('UNAUTHENTICATED', 401);
    return user;
  }

  async function limits(user: UserRecord) {
    return (await subs.isPremium(user)) ? billing.limits.premium : billing.limits.free;
  }

  async function view(user: UserRecord): Promise<EntitlementsView> {
    const premium = await subs.isPremium(user);
    const period = usagePeriod(deps.now());
    const lim = premium ? billing.limits.premium : billing.limits.free;
    return {
      tier: premium ? 'PREMIUM' : 'FREE',
      scans: { used: await stores.usage.get(user.id, 'SCAN', period), limit: lim.scans },
      sms: { used: await stores.usage.get(user.id, 'SMS', period), limit: lim.sms },
      doctorSummaryCredits: await stores.entitlements.available(user.id, 'DOCTOR_SUMMARY'),
      features: premium ? PREMIUM_FEATURES : [],
    };
  }

  const payWith = (purpose: Feature) => ({
    purpose,
    amount: billing.caas[purpose].amount,
    currency: 'BDT' as const,
  });

  /** A scan: the monthly allowance first, then a paid credit. */
  async function useScan(userId: string): Promise<UseResult> {
    const user = await userById(userId);
    const lim = await limits(user);
    const period = usagePeriod(deps.now());
    if ((await stores.usage.incrementIfBelow(userId, 'SCAN', period, lim.scans)) !== null) {
      return { allowed: true, via: 'QUOTA' };
    }
    if (await stores.entitlements.consume(userId, 'SCAN')) return { allowed: true, via: 'CREDIT' };
    return { allowed: false, reason: 'QUOTA_EXCEEDED', payWith: payWith('SCAN') };
  }

  /** A reminder SMS counts against the monthly cap (free tier SMS has a real cost). */
  async function useSms(userId: string): Promise<{ allowed: boolean }> {
    const user = await userById(userId);
    const lim = await limits(user);
    const period = usagePeriod(deps.now());
    return {
      allowed: (await stores.usage.incrementIfBelow(userId, 'SMS', period, lim.sms)) !== null,
    };
  }

  /** A paid-per-use feature: included for Premium, otherwise a credit from a settled charge. */
  async function useFeature(userId: string, feature: Exclude<Feature, 'SCAN'>): Promise<UseResult> {
    const user = await userById(userId);
    if (PREMIUM_INCLUDES.has(feature) && (await subs.isPremium(user))) {
      return { allowed: true, via: 'PREMIUM' };
    }
    if (await stores.entitlements.consume(userId, feature)) return { allowed: true, via: 'CREDIT' };
    return { allowed: false, reason: 'QUOTA_EXCEEDED', payWith: payWith(feature) };
  }

  return { view, useScan, useSms, useFeature };
}

export type EntitlementService = ReturnType<typeof createEntitlementService>;
