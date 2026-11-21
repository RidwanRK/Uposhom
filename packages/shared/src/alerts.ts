import { z } from 'zod';

/** Proposed endpoint: GET /api/v1/alerts (the Alerts inbox, design.md Screen 13). */
export const alertType = z.enum([
  'MISSED_DOSE',
  'REFILL_DUE',
  'FOLLOW_UP',
  'WEEKLY_DIGEST',
  'SMS_FAILURE',
]);
export type AlertType = z.infer<typeof alertType>;

export const alertItem = z.object({
  id: z.string(),
  type: alertType,
  createdAt: z.string(),
  profileId: z.string(),
  profileName: z.string(),
  title: z.string(),
  body: z.string().optional(),
  doseId: z.string().optional(),
  medicine: z.string().optional(),
  dueAt: z.string().optional(),
  overdueMinutes: z.number().optional(),
  callPhone: z.string().optional(),
  acknowledged: z.boolean(),
  acknowledgedAt: z.string().nullable().optional(),
});
export type AlertItem = z.infer<typeof alertItem>;
export const alertsResponse = z.object({ alerts: z.array(alertItem) });
