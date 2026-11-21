import { z } from 'zod';

export const journalBody = z.object({
  profileId: z.string(),
  inputText: z.string(),
  channel: z.enum(['TEXT', 'VOICE']),
  /** Proposed: continue an in-progress journal (follow-up answers). */
  sessionId: z.string().optional(),
  skip: z.boolean().optional(),
});
export type JournalBody = z.infer<typeof journalBody>;

export const doctorSummary = z.object({
  id: z.string().optional(),
  symptoms: z.string(),
  onset: z.string().optional(),
  duration: z.string().optional(),
  severity: z.string().optional(),
  triggers: z.string().optional(),
  associated: z.string().optional(),
  currentMedicines: z.array(z.string()),
  recentPrescriptions: z.array(z.string()),
  createdAt: z.string().optional(),
});
export type DoctorSummary = z.infer<typeof doctorSummary>;

export const journalResponse = z.object({
  isRedFlag: z.boolean(),
  alertMessage: z.string().optional(),
  emergencyDial: z.string().optional(),
  collectedSlots: z.record(z.string(), z.string()).optional(),
  doctorSummaryReady: z.boolean(),
  /** Proposed: next short Bangla follow-up question (max six) and progress. */
  sessionId: z.string().optional(),
  nextQuestion: z.string().nullable().optional(),
  questionIndex: z.number().optional(),
  questionTotal: z.number().optional(),
  summary: doctorSummary.optional(),
});
export type JournalResponse = z.infer<typeof journalResponse>;

export const doctorSummaryBody = z.object({
  profileId: z.string(),
  summaryId: z.string().optional(),
});
export const doctorSummaryResponse = z.object({ summary: doctorSummary });
