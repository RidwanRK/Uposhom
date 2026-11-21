import { z } from 'zod';
import { mealRelation } from './common.js';

export const extractedItem = z.object({
  tempId: z.string(),
  brandName: z.string(),
  genericName: z.string().optional(),
  strength: z.string(),
  form: z.string(),
  pattern: z.string(),
  mealRelation,
  durationDays: z.number(),
  confidence: z.number(), // 0-1
  isCritical: z.boolean().optional(), // the model never decides this; a person does
  pillCount: z.number().optional(),
});
export type ExtractedItem = z.infer<typeof extractedItem>;

export const uploadAndParseResponse = z.object({
  draftPrescriptionId: z.string(),
  transcribedText: z.string(),
  extractedItems: z.array(extractedItem),
});
export type UploadAndParseResponse = z.infer<typeof uploadAndParseResponse>;

export const confirmItem = z.object({
  brandName: z.string(),
  dosageStrength: z.string(),
  form: z.string(),
  parsedPattern: z.string(),
  mealRelation,
  durationDays: z.number(),
  isCritical: z.boolean(),
  pillCount: z.number().optional(),
});
export type ConfirmItem = z.infer<typeof confirmItem>;

export const confirmBody = z.object({ profileId: z.string(), items: z.array(confirmItem) });
export const confirmResponse = z.object({
  prescriptionId: z.string(),
  status: z.string(),
  scheduledEventsCount: z.number(),
  firstDoseAt: z.string().nullable().optional(),
  banglaSummary: z.string(),
});
export type ConfirmResponse = z.infer<typeof confirmResponse>;
