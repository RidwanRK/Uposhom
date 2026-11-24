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
import { AI_CONFIG } from '../config.js';

export interface TranscribeOptions {
  apiKey?: string;
  model?: string;
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
 * Supports:
 * - Dedicated STT endpoint (Whisper-1 via OpenRouter)
 * - Free multimodal audio fallback (e.g. nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free)
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
  const requestedModel = options.model || AI_CONFIG.models.audioSTT;

  const toBase64 = (data: Buffer | Uint8Array | Blob | string): string => {
    if (typeof data === 'string') return data.replace(/^data:audio\/\w+;base64,/, '');
    if (Buffer.isBuffer(data)) return data.toString('base64');
    if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
    return '';
  };

  const transcribeViaChat = async (modelSlug: string): Promise<string> => {
    const base64Audio = toBase64(audioData);
    const res = await client.chat.completions.create({
      model: modelSlug,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Transcribe the attached audio clip into accurate Bangla text. ' +
                `Context medical vocabulary: ${options.prompt || BANGLA_MEDICAL_VOCABULARY_PROMPT}. ` +
                'Return ONLY the raw transcribed Bangla text. Do not add explanations or formatting.',
            },
            {
              type: 'input_audio',
              input_audio: {
                data: base64Audio,
                format: 'm4a',
              },
            } as any,
          ],
        },
      ],
      temperature: 0.0,
    });
    return res.choices[0]?.message?.content?.trim() || '';
  };

  // If a free multimodal audio model is specifically requested
  if (requestedModel.includes(':free') || requestedModel.includes('omni') || requestedModel.includes('audio')) {
    try {
      const text = await transcribeViaChat(requestedModel);
      if (text) {
        return transcribeResponse.parse({ transcript: text });
      }
    } catch {
      // If chat completions fails, fall through to STT attempt
    }
  }

  try {
    let filePayload: File | Blob;
    if (typeof audioData === 'string') {
      const buffer = Buffer.from(audioData.replace(/^data:audio\/\w+;base64,/, ''), 'base64');
      filePayload = new File([buffer], 'audio.m4a', { type: 'audio/m4a' });
    } else if (audioData instanceof Blob) {
      filePayload = audioData;
    } else {
      const arrayBuffer =
        audioData instanceof Buffer
          ? audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)
          : audioData;
      filePayload = new File([arrayBuffer as ArrayBuffer], 'audio.m4a', { type: 'audio/m4a' });
    }

    const transcription = await client.audio.transcriptions.create({
      file: filePayload,
      model: requestedModel.includes(':free') ? 'whisper-1' : requestedModel,
      language: options.language || 'bn',
      prompt: options.prompt || BANGLA_MEDICAL_VOCABULARY_PROMPT,
      temperature: 0.0,
    });

    return transcribeResponse.parse({
      transcript: transcription.text.trim(),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);

    // If Whisper fails due to insufficient balance/quota on a free OpenRouter account,
    // attempt fallback to the free audio-capable model
    if (errMsg.includes('402') || errMsg.toLowerCase().includes('insufficient') || errMsg.toLowerCase().includes('credits')) {
      try {
        const text = await transcribeViaChat('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
        if (text) {
          return transcribeResponse.parse({ transcript: text });
        }
      } catch {
        // Fall through to error
      }
    }

    throw new Error(`Voice transcription failed: ${errMsg}`, { cause: error });
  }
}
