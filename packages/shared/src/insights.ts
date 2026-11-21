import { z } from 'zod';

export const timelineEntry = z.object({
  id: z.string(),
  date: z.string(), // yyyy-mm-dd
  kind: z.enum(['SYMPTOM', 'PRESCRIPTION']),
  title: z.string(),
  therapeuticClass: z.string().optional(),
});
export type TimelineEntry = z.infer<typeof timelineEntry>;

export const patternCard = z.object({
  id: z.string(),
  sentenceBn: z.string(),
  monthly: z.array(z.object({ month: z.string(), count: z.number() })),
  tipBn: z.string(),
});
export type PatternCard = z.infer<typeof patternCard>;

export const insightsResponse = z.object({
  timeline: z.array(timelineEntry),
  /** Empty when the minimum record count is not met, or when the circle is Free. */
  patterns: z.array(patternCard),
  patternsLocked: z.boolean().optional(),
});
export type InsightsResponse = z.infer<typeof insightsResponse>;
