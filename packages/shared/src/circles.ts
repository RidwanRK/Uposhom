import { z } from 'zod';
import { circleTier, linkRole } from './common.js';

export const mealTimes = z.object({
  morning: z.string(), // 'HH:mm', Asia/Dhaka
  noon: z.string(),
  evening: z.string(),
  night: z.string(),
});
export type MealTimes = z.infer<typeof mealTimes>;

export const quietHours = z.object({ start: z.string(), end: z.string() });

export const profileLink = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  role: linkRole,
  isSecondaryCaregiver: z.boolean().optional(),
});
export type ProfileLink = z.infer<typeof profileLink>;

export const profile = z.object({
  id: z.string(),
  name: z.string(),
  relationship: z.string(), // 'SELF' | 'FATHER' | 'MOTHER' | 'DAUGHTER' | ...
  age: z.number().nullable().optional(),
  avatar: z.string().optional(),
  adherenceRate: z.number().nullable().optional(), // percent, 0-100
  status: z.enum(['OK', 'MISSED_CRITICAL']).optional(),
  allergies: z.string().optional(),
  mealTimes,
  quietHours: quietHours.optional(),
  phoneLinked: z.boolean().optional(),
  links: z.array(profileLink).optional(),
  /** Role of the signed-in user on this profile. */
  myRole: linkRole.optional(),
});
export type Profile = z.infer<typeof profile>;

export const circleResponse = z.object({
  circle: z.object({
    id: z.string(),
    tier: circleTier,
    memberCount: z.number(),
    maxProfiles: z.number().optional(),
  }),
  profiles: z.array(profile),
});
export type CircleResponse = z.infer<typeof circleResponse>;

export const createProfileBody = z.object({
  name: z.string(),
  age: z.number().optional(),
  relationship: z.string(),
  msisdn: z.string().optional(),
  mealTimes: mealTimes.optional(),
});
export const updateProfileBody = z.object({
  name: z.string().optional(),
  relationship: z.string().optional(),
  age: z.number().optional(),
  allergies: z.string().optional(),
  mealTimes: mealTimes.optional(),
  quietHours: quietHours.optional(),
});

/** Family Link OTP for a dependent's own phone (proposed endpoints, backend calls Applink). */
export const linkRequestBody = z.object({ msisdn: z.string() });
export const linkVerifyBody = z.object({ msisdn: z.string(), otp: z.string() });
export const inviteBody = z.object({ profileId: z.string(), msisdn: z.string(), role: linkRole });
export const changeRoleBody = z.object({ role: linkRole });
