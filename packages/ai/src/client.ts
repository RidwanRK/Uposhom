import OpenAI from 'openai';
import { OpenAIProvider, OpenAIChatCompletionsModel } from '@openai/agents';
import { AI_CONFIG, type SupportedModelId } from './config.js';

/**
 * Creates an OpenAI SDK client configured for OpenRouter.
 */
export function createOpenRouterClient(apiKey?: string, baseURL?: string): OpenAI {
  const key = apiKey || process.env.OPENROUTER_API_KEY || 'mock-key-for-local-development';
  const url = baseURL || process.env.OPENROUTER_BASE_URL || AI_CONFIG.openRouterBaseUrl;

  return new OpenAI({
    apiKey: key,
    baseURL: url,
    defaultHeaders: {
      'HTTP-Referer': AI_CONFIG.headers.referer,
      'X-Title': AI_CONFIG.headers.title,
    },
  });
}

/**
 * Creates an OpenAIProvider instance configured with the OpenRouter client.
 */
export function createOpenRouterProvider(openaiClient?: OpenAI): OpenAIProvider {
  const client = openaiClient || createOpenRouterClient();
  return new OpenAIProvider({ openAIClient: client });
}

/**
 * Creates an OpenAIChatCompletionsModel for OpenAI Agents SDK running over OpenRouter.
 */
export function createOpenRouterAgentModel(
  modelId: SupportedModelId = AI_CONFIG.models.agentsPrimary,
  openaiClient?: OpenAI,
): OpenAIChatCompletionsModel {
  const client = openaiClient || createOpenRouterClient();
  return new OpenAIChatCompletionsModel(client, modelId);
}
