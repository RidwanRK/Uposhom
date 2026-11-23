import { z } from 'zod';

/** Follow-up appointments (docs/domain-api.md). `dueAt` is ISO 8601 with an offset, in the future. */
export const appointmentBody = z.object({ title: z.string().min(1).max(100), dueAt: z.string() });
export type AppointmentBody = z.infer<typeof appointmentBody>;

export const appointment = z.object({
  id: z.string(),
  title: z.string(),
  dueAt: z.string(),
  reminderState: z.string().optional(),
});
export type Appointment = z.infer<typeof appointment>;

export const appointmentsResponse = z.object({ appointments: z.array(appointment) });
