/**
 * OpenRouter & Agent Model Configurations
 *
 * Model slug can be controlled via environment variables:
 * - OPENROUTER_MODEL: Primary model slug used across agents & vision (e.g. 'google/gemini-2.5-flash', 'deepseek/deepseek-chat')
 * - OPENROUTER_MODEL_AGENTS: Specific model slug override for conversational & specialist agents
 * - OPENROUTER_MODEL_VISION: Specific model slug override for prescription and report vision OCR
 * - OPENROUTER_MODEL_VISION_FALLBACK: Fallback model slug for vision OCR
 * - OPENROUTER_MODEL_FALLBACK: Fallback model slug for conversational agents
 */

export const AI_CONFIG = {
  get openRouterBaseUrl(): string {
    return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  },
  get openRouterApiKey(): string {
    return process.env.OPENROUTER_API_KEY || '';
  },
  models: {
    get visionPrimary(): string {
      return (
        process.env.OPENROUTER_MODEL_VISION ||
        process.env.OPENROUTER_MODEL ||
        'google/gemini-2.5-flash'
      );
    },
    get visionFallback(): string {
      return (
        process.env.OPENROUTER_MODEL_VISION_FALLBACK ||
        'qwen/qwen2.5-vl-72b-instruct'
      );
    },
    get agentsPrimary(): string {
      return (
        process.env.OPENROUTER_MODEL_AGENTS ||
        process.env.OPENROUTER_MODEL ||
        'google/gemini-2.5-flash'
      );
    },
    get agentsFallback(): string {
      return (
        process.env.OPENROUTER_MODEL_FALLBACK ||
        'openai/gpt-4o-mini'
      );
    },
  },
  headers: {
    referer: 'https://uposhom.health',
    title: 'Uposhom Healthcare Assistant',
  },
};

export type SupportedModelId =
  | 'google/gemini-2.5-flash'
  | 'qwen/qwen2.5-vl-72b-instruct'
  | 'openai/gpt-4o-mini'
  | (string & {});

export const SUPPORTED_MODELS: readonly string[] = [
  'google/gemini-2.5-flash',
  'qwen/qwen2.5-vl-72b-instruct',
  'openai/gpt-4o-mini',
];
