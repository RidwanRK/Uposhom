import { z } from 'zod';

export const accountSettings = z.object({
  discreetSms: z.boolean(),
  smsReminders: z.boolean(),
});
export type AccountSettings = z.infer<typeof accountSettings>;

export const optOutBody = z.object({ scope: z.enum(['SMS', 'SUBSCRIPTION', 'ALL']) });
export const registerDeviceBody = z.object({
  expoPushToken: z.string(),
  platform: z.literal('android'),
});
