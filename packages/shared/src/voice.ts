import { z } from 'zod';

export const transcribeResponse = z.object({ transcript: z.string() });
export const voiceQueryBody = z.object({ profileId: z.string(), text: z.string() });
export const voiceQueryResponse = z.object({ answerText: z.string() });
