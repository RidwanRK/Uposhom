import { z } from 'zod';
import { circleTier } from './common.js';

export const accountType = z.enum(['INDIVIDUAL', 'PHARMACY']);
export type AccountType = z.infer<typeof accountType>;

export const otpRequestBody = z.object({ msisdn: z.string() });
export const otpRequestResponse = z.object({
  success: z.boolean(),
  maskedPhone: z.string(),
  expiresInSeconds: z.number(),
});

export const otpVerifyBody = z.object({
  msisdn: z.string(),
  otp: z.string(),
  /** Proposed addition: only read when the number signs up for the first time. */
  accountType: accountType.optional(),
});

export const sessionUser = z.object({
  id: z.string(),
  msisdn: z.string(),
  role: z.enum(['FAMILY_ADMIN', 'PHARMACY_OWNER']),
  /** Proposed addition: the admin flag that unlocks the Agent Traces screen. */
  isAdmin: z.boolean().optional(),
});
export type SessionUser = z.infer<typeof sessionUser>;

export const otpVerifyResponse = z.object({
  success: z.boolean(),
  token: z.string(),
  /** Rotating 90-day refresh token (Master Plan section 5). Optional until A confirms the field name. */
  refreshToken: z.string().optional(),
  user: sessionUser,
  circle: z
    .object({ id: z.string(), tier: circleTier, memberCount: z.number() })
    .nullable()
    .optional(),
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponse>;

export const refreshBody = z.object({ refreshToken: z.string() });
export const refreshResponse = z.object({ token: z.string(), refreshToken: z.string().optional() });

/** Step-up code before a sensitive action (remove a person, delete my data). Proposed endpoints. */
export const stepUpVerifyBody = z.object({ otp: z.string() });
export const stepUpVerifyResponse = z.object({ stepUpToken: z.string() });
