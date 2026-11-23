import { z } from 'zod';

/** Error body returned by every non-2xx response. `code` is a stable machine string, never shown raw. */
export const apiErrorBody = z.object({
  success: z.literal(false).optional(),
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    retryAfterSeconds: z.number().optional(),
    /** e.g. NEEDS_MANUAL_INPUT: [{ index, reasons }] (docs/domain-api.md). */
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBody>;

/** Codes the server maps Applink status codes to (design.md 6.11). */
export const authErrorCodes = [
  'NUMBER_NOT_ACCEPTED', // E1317
  'NUMBER_BLOCKED', // E1342
  'NOT_ON_TEST_LIST', // E1343
  'SERVICE_TROUBLE', // E1603, E1601, E1856
  'RATE_LIMITED',
  'OTP_WRONG', // E1850 (retry on the same session)
  'OTP_EXPIRED', // E1851, E1855 (ask for a new code)
] as const;
export type AuthErrorCode = (typeof authErrorCodes)[number];

export const mealRelation = z.enum(['AC', 'PC', 'WITH_MEAL', 'NONE']);
export type MealRelation = z.infer<typeof mealRelation>;

export const circleTier = z.enum(['FREE', 'PREMIUM']);
export type CircleTier = z.infer<typeof circleTier>;

export const linkRole = z.enum(['ADMIN', 'CAREGIVER', 'VIEWER']);
export type LinkRole = z.infer<typeof linkRole>;

export const okResponse = z.object({ success: z.boolean() });
