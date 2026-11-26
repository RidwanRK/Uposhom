import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AI_CONFIG, type SupportedModelId } from '../src/config.js';
import { createOpenRouterAgentModel } from '../src/client.js';

describe('OpenRouter Model Configuration via Environment Variables', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_MODEL_AGENTS;
    delete process.env.OPENROUTER_MODEL_VISION;
    delete process.env.OPENROUTER_MODEL_VISION_FALLBACK;
    delete process.env.OPENROUTER_MODEL_FALLBACK;
    delete process.env.OPENROUTER_MODEL_AUDIO;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to google/gemini-2.5-flash when no env var is set', () => {
    expect(AI_CONFIG.models.agentsPrimary).toBe('google/gemini-2.5-flash');
    expect(AI_CONFIG.models.visionPrimary).toBe('google/gemini-2.5-flash');
    expect(AI_CONFIG.models.visionFallback).toBe('qwen/qwen2.5-vl-72b-instruct');
    expect(AI_CONFIG.models.agentsFallback).toBe('openai/gpt-4o-mini');
    expect(AI_CONFIG.models.audioSTT).toBe('whisper-1');
  });

  it('controls audio STT model via OPENROUTER_MODEL_AUDIO', () => {
    process.env.OPENROUTER_MODEL_AUDIO = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
    expect(AI_CONFIG.models.audioSTT).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  });

  it('controls primary model slug across agents and vision via OPENROUTER_MODEL', () => {
    process.env.OPENROUTER_MODEL = 'deepseek/deepseek-chat';

    expect(AI_CONFIG.models.agentsPrimary).toBe('deepseek/deepseek-chat');
    expect(AI_CONFIG.models.visionPrimary).toBe('deepseek/deepseek-chat');
  });

  it('supports fine-grained overrides for vision and agents', () => {
    process.env.OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct';
    process.env.OPENROUTER_MODEL_VISION = 'anthropic/claude-3.5-sonnet';
    process.env.OPENROUTER_MODEL_AGENTS = 'deepseek/deepseek-chat';

    expect(AI_CONFIG.models.visionPrimary).toBe('anthropic/claude-3.5-sonnet');
    expect(AI_CONFIG.models.agentsPrimary).toBe('deepseek/deepseek-chat');
  });

  it('createOpenRouterAgentModel automatically uses OPENROUTER_MODEL slug', () => {
    process.env.OPENROUTER_MODEL = 'custom-org/custom-healthcare-model';

    const agentModel = createOpenRouterAgentModel();
    expect(agentModel.model).toBe('custom-org/custom-healthcare-model');
  });

  it('allows explicit modelId override when calling createOpenRouterAgentModel', () => {
    process.env.OPENROUTER_MODEL = 'default-model';
    const explicitSlug: SupportedModelId = 'anthropic/claude-3.5-haiku';

    const agentModel = createOpenRouterAgentModel(explicitSlug);
    expect(agentModel.model).toBe('anthropic/claude-3.5-haiku');
  });
});
