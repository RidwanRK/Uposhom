import { z } from 'zod';

export const doseStatus = z.enum([
  'SCHEDULED',
  'TAKEN',
  'TAKEN_LATE',
  'SNOOZED',
  'SKIPPED',
  'MISSED',
]);
export type DoseStatus = z.infer<typeof doseStatus>;

export const dose = z.object({
  id: z.string(),
  time: z.string().optional(), // server display string; the app formats dueAt itself
  dueAt: z.string(), // ISO with +06:00
  medicine: z.string(),
  form: z.string().optional(),
  instructions: z.string().optional(),
  status: doseStatus,
  takenAt: z.string().nullable().optional(),
  isCritical: z.boolean().optional(),
  /** Optional additions: Bangla brand name and strength for the card badge. */
  medicineBn: z.string().optional(),
  strength: z.string().optional(),
  mealRelation: z.string().optional(),
  profileId: z.string().optional(),
  /** When a snoozed dose will remind again (ISO +06:00). dueAt keeps the original time. */
  snoozedUntil: z.string().nullable().optional(),
});
export type Dose = z.infer<typeof dose>;

export const todayDosesResponse = z.object({
  date: z.string(),
  timezone: z.string(),
  doses: z.array(dose),
  adherenceRate: z.number().nullable().optional(),
});
export type TodayDosesResponse = z.infer<typeof todayDosesResponse>;

export const doseAction = z.enum(['TAKEN', 'SNOOZE', 'SKIP']);
export type DoseAction = z.infer<typeof doseAction>;

export const doseActionBody = z.object({
  action: doseAction,
  snoozeMinutes: z.number().optional(),
  skipReason: z.string().optional(),
});
export type DoseActionBody = z.infer<typeof doseActionBody>;

export const doseActionResponse = z.object({
  success: z.boolean(),
  doseId: z.string(),
  newStatus: doseStatus,
  updatedAdherenceRate: z.number().nullable().optional(),
});
export type DoseActionResponse = z.infer<typeof doseActionResponse>;
