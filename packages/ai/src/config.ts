/**
 * OpenRouter & Agent Model Configurations
 *
 * Model IDs verified on OpenRouter (Nov 2026):
 * - Vision extraction: google/gemini-2.5-flash (primary), qwen/qwen2.5-vl-72b-instruct (fallback)
 * - Conversational & Agents: google/gemini-2.5-flash, openai/gpt-4o-mini
 */

export const AI_CONFIG = {
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
  models: {
    visionPrimary: 'google/gemini-2.5-flash',
    visionFallback: 'qwen/qwen2.5-vl-72b-instruct',
    agentsPrimary: 'google/gemini-2.5-flash',
    agentsFallback: 'openai/gpt-4o-mini',
  },
  headers: {
    referer: 'https://uposhom.health',
    title: 'Uposhom Healthcare Assistant',
  },
} as const;

export type SupportedModelId =
  | 'google/gemini-2.5-flash'
  | 'qwen/qwen2.5-vl-72b-instruct'
  | 'openai/gpt-4o-mini';

export const SUPPORTED_MODELS: readonly SupportedModelId[] = [
  'google/gemini-2.5-flash',
  'qwen/qwen2.5-vl-72b-instruct',
  'openai/gpt-4o-mini',
];
