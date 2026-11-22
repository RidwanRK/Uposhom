import { describe, it, expect } from 'vitest';
import { createOpenRouterClient } from '../src/client.js';
import { AI_CONFIG } from '../src/config.js';
import { runTriageRouter } from '../src/agents/router.js';

const shouldRunLive = Boolean(process.env.RUN_LIVE_TESTS === '1' || process.env.TEST_LIVE === '1');

describe.skipIf(!shouldRunLive)('Live OpenRouter Agent Integration Tests (Guarded by RUN_LIVE_TESTS=1)', () => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const isLiveConfigured = Boolean(apiKey && !apiKey.startsWith('mock-'));

  it('verifies environment configuration is loaded', () => {
    expect(AI_CONFIG.models.agentsPrimary).toBeDefined();
    console.log('\n--- OpenRouter Live Configuration ---');
    console.log('Model Slug:', AI_CONFIG.models.agentsPrimary);
    console.log('Base URL:', AI_CONFIG.openRouterBaseUrl);
    console.log('API Key Configured:', isLiveConfigured ? 'Yes (Valid key present)' : 'No');
    console.log('-------------------------------------\n');
  });

  it('successfully invokes live OpenRouter model for Bangla healthcare inquiry', async () => {
    if (!isLiveConfigured) {
      console.warn('Skipping live test: OPENROUTER_API_KEY is not set or is mock.');
      return;
    }

    const client = createOpenRouterClient(apiKey);
    const chosenModel = AI_CONFIG.models.agentsPrimary;

    console.log(`Sending live request to OpenRouter model [${chosenModel}]...`);
    const startTime = Date.now();

    const response = await client.chat.completions.create({
      model: chosenModel,
      messages: [
        {
          role: 'system',
          content:
            'You are Uposhom healthcare assistant. Answer politely in clear, concise Bangla. Do not prescribe new prescription medicines.',
        },
        {
          role: 'user',
          content: 'সুস্থ থাকার জন্য প্রতিদিন কতটুকু পানি পান করা উচিত? সংক্ষেপে বাংলায় বলুন।',
        },
      ],
      max_tokens: 1000,
      temperature: 0.3,
    });

    const elapsed = Date.now() - startTime;
    const choiceMsg = response.choices[0]?.message;
    const content =
      choiceMsg?.content ||
      (choiceMsg as unknown as { reasoning?: string })?.reasoning;

    console.log(`\n=== Live Model Response (${elapsed}ms) ===`);
    console.log('Model used:', response.model || chosenModel);
    console.log('Reply:\n', content);
    console.log('==========================================\n');

    expect(content).toBeDefined();
    expect(typeof content).toBe('string');
    expect(content!.length).toBeGreaterThan(10);
  }, 35000);

  it('runs multi-agent router with live model fallback for general triage', async () => {
    if (!isLiveConfigured) return;

    console.log('Executing runTriageRouter with live model enabled...');
    const result = await runTriageRouter('সুস্থ থাকতে প্রতিদিন কয় ঘণ্টা ঘুমানো দরকার?', {
      useLiveModel: true,
      apiKey,
    });

    console.log('\n=== Triage Router Live Run Result ===');
    console.log('Target Agent:', result.targetAgent);
    console.log('Trace ID:', result.trace.id);
    console.log('Latency:', `${result.trace.latencyMs}ms`);
    console.log('Live Reply:\n', result.reply);
    console.log('=====================================\n');

    expect(result.targetAgent).toBe('TriageAgent');
    expect(result.reply.length).toBeGreaterThan(10);
    expect(result.trace).toBeDefined();
  }, 35000);

  it('preserves 0-latency emergency interceptor even when live model is active', async () => {
    const startTime = Date.now();
    const result = await runTriageRouter('আমার বুকে তীব্র ব্যথা ও দম বন্ধ হয়ে আসছে', {
      useLiveModel: true,
      apiKey,
    });
    const elapsed = Date.now() - startTime;

    console.log(`\nEmergency interceptor elapsed time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(150); // Instant 0-latency check, no API call
    expect(result.targetAgent).toBe('EmergencyAgent');
    expect(result.reply).toContain('৯৯৯');
  });

  it('routes to GenericFinderAgent and performs brand matching tool call', async () => {
    const result = await runTriageRouter('নাপার বিকল্প কমদামী ওষুধ কি আছে?', {
      useLiveModel: true,
      apiKey,
    });

    console.log('\n=== Generic Finder Agent Tool Result ===');
    console.log('Target Agent:', result.targetAgent);
    console.log('Tool Calls:', result.toolCalls.map((t) => t.name).join(', '));
    console.log('Handoffs:', result.handoffs.map((h) => `${h.from} -> ${h.to}`).join(', '));
    console.log('Reply:\n', result.reply);
    console.log('========================================\n');

    expect(result.targetAgent).toBe('GenericFinderAgent');
    expect(result.toolCalls.some((t) => t.name === 'searchAlternatives')).toBe(true);
    expect(result.reply).toContain('Napa');
  });
});
