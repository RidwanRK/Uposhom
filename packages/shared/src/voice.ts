import { z } from 'zod';

export const transcribeResponse = z.object({ transcript: z.string() });
export type TranscribeResponse = z.infer<typeof transcribeResponse>;

export const voiceQueryBody = z.object({ profileId: z.string(), text: z.string() });
export type VoiceQueryBody = z.infer<typeof voiceQueryBody>;

export const voiceQueryResponse = z.object({ answerText: z.string() });
export type VoiceQueryResponse = z.infer<typeof voiceQueryResponse>;
