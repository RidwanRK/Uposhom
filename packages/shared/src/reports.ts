import { z } from 'zod';

export const reportValue = z.object({
  test: z.string(), // 'Fasting Blood Glucose (রক্তের শর্করা)'
  value: z.string(),
  unit: z.string(),
  printedRange: z.string(), // '3.9 - 6.1 mmol/L', exactly as printed
  flag: z.enum(['HIGH', 'LOW', 'NORMAL', 'UNKNOWN']),
  explanationBn: z.string(),
});
export type ReportValue = z.infer<typeof reportValue>;

export const reportSummary = z.object({
  id: z.string(),
  date: z.string(),
  center: z.string(),
  testType: z.string(),
  profileId: z.string().optional(),
});
export type ReportSummary = z.infer<typeof reportSummary>;

export const reportDetail = reportSummary.extend({ values: z.array(reportValue) });
export type ReportDetail = z.infer<typeof reportDetail>;

export const reportListResponse = z.object({ reports: z.array(reportSummary) });
