/**
 * Voice Audio Transcription Module
 *
 * Implements audio transcription for Uposhom voice input (symptom journaling,
 * voice schedule queries) using Whisper API via OpenRouter or direct OpenAI.
 *
 * Strict Non-LLM Boundary: Audio transcription outputs plain text only.
 * The transcript is displayed on the user's mobile screen for visual confirmation
 * and editing before being submitted to any agent or state machine.
 */

import { transcribeResponse, type TranscribeResponse } from '@uposhom/shared';
import { createOpenRouterClient } from '../client.js';

export interface TranscribeOptions {
  apiKey?: string;
  language?: string; // defaults to 'bn' (Bangla)
  prompt?: string; // vocabulary biasing prompt (e.g. medical names)
  mockTranscript?: string;
}

export const BANGLA_MEDICAL_VOCABULARY_PROMPT =
  'নাপা, এইস, সেকলো, সারজেল, ফ্লেক্সিল, মন্টিয়ার, অ্যাজিথ্রোমাইসিন, ' +
  'প্যারাসিটামল, ওমিপ্রাজল, এন্টাসিড, প্রেশার, প্রেসার, ডায়াবেটিস, ইনসুলিন, ' +
  'শ্বাসকষ্ট, বুকে ব্যথা, সকাল, দুপুর, রাত, খাবার আগে, খাবার পরে।';

/**
 * Transcribes Bangla audio input to text.
 */
export async function transcribeBanglaAudio(
  audioData: Buffer | Uint8Array | Blob | string,
  options: TranscribeOptions = {},
): Promise<TranscribeResponse> {
  // If mock transcript is supplied or test environment without live key
  if (options.mockTranscript) {
    return transcribeResponse.parse({ transcript: options.mockTranscript });
  }

  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.startsWith('mock-')) {
    // Return standard mock transcript for test and offline dev runs
    return transcribeResponse.parse({
      transcript: 'আমার সকালের নাপা খাওয়ার কথা মনে করিয়ে দিও',
    });
  }

  const client = createOpenRouterClient(apiKey);

  // If audioData is already a string (e.g. data URI or filepath), handle appropriately
  // For OpenRouter/OpenAI Whisper endpoint:
  try {
    let filePayload: File | Blob;
    if (typeof audioData === 'string') {
      // Base64 or mock string
      const buffer = Buffer.from(audioData.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      filePayload = new File([buffer], 'audio.m4a', { type: 'audio/m4a' });
    } else if (audioData instanceof Uint8Array || Buffer.isBuffer(audioData)) {
      filePayload = new File([audioData], 'audio.m4a', { type: 'audio/m4a' });
    } else {
      filePayload = audioData as Blob;
    }

    const transcription = await client.audio.transcriptions.create({
      file: filePayload,
      model: 'whisper-1',
      language: options.language || 'bn',
      prompt: options.prompt || BANGLA_MEDICAL_VOCABULARY_PROMPT,
      temperature: 0.0,
    });

    return transcribeResponse.parse({
      transcript: transcription.text.trim(),
    });
  } catch (error) {
    // If audio endpoint fails, provide graceful fallback if mock is available or rethrow
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Voice transcription failed: ${errMsg}`);
  }
}
