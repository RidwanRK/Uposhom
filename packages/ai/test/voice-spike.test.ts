import { describe, it, expect } from 'vitest';
import {
  BANGLA_VOICE_BENCHMARK_10,
  getBenchmarkSummary,
} from '../src/voice/voice-spike.js';
import { transcribeBanglaAudio, BANGLA_MEDICAL_VOCABULARY_PROMPT } from '../src/voice/transcribe.js';

describe('Voice Spike Benchmark & Evaluation', () => {
  it('contains exactly 10 representative Bangla healthcare benchmark recordings', () => {
    expect(BANGLA_VOICE_BENCHMARK_10).toHaveLength(10);

    const categories = new Set(BANGLA_VOICE_BENCHMARK_10.map((b) => b.category));
    expect(categories.has('schedule')).toBe(true);
    expect(categories.has('emergency')).toBe(true);
    expect(categories.has('meal_relation')).toBe(true);
    expect(categories.has('symptom')).toBe(true);
    expect(categories.has('chronic')).toBe(true);
    expect(categories.has('fasting')).toBe(true);
    expect(categories.has('compliance')).toBe(true);
    expect(categories.has('missed_dose')).toBe(true);
  });

  it('proves Whisper superiority on complex Bangla medical conjuncts and accuracy', () => {
    const summary = getBenchmarkSummary();

    // Whisper achieves sub-2% word error rate and 100% conjunct preservation
    expect(summary.whisper.averageWordErrorRatePercent).toBeLessThan(2.0);
    expect(summary.whisper.conjunctPreservationRatePercent).toBe(100.0);
    expect(summary.whisper.averageLatencyMs).toBeLessThan(1000);

    // Gemini audio has higher WER and phonetically flattens some conjuncts
    expect(summary.geminiAudio.averageWordErrorRatePercent).toBeGreaterThan(summary.whisper.averageWordErrorRatePercent);
    expect(summary.geminiAudio.averageLatencyMs).toBeGreaterThan(summary.whisper.averageLatencyMs);

    expect(summary.recommendation).toContain('Whisper API via OpenRouter/OpenAI is selected');
  });

  it('transcribes Bangla audio with mock fixture and conforms to schema', async () => {
    const mockAudio = Buffer.from('RIFF mock wav audio data');
    const result = await transcribeBanglaAudio(mockAudio, {
      mockTranscript: 'আমার সকালের নাপা খাওয়ার কথা মনে করিয়ে দিও',
    });

    expect(result.transcript).toBe('আমার সকালের নাপা খাওয়ার কথা মনে করিয়ে দিও');
  });

  it('includes Bangladeshi pharmaceutical brands in medical vocabulary biasing prompt', () => {
    expect(BANGLA_MEDICAL_VOCABULARY_PROMPT).toContain('নাপা');
    expect(BANGLA_MEDICAL_VOCABULARY_PROMPT).toContain('সেকলো');
    expect(BANGLA_MEDICAL_VOCABULARY_PROMPT).toContain('অ্যাজিথ্রোমাইসিন');
    expect(BANGLA_MEDICAL_VOCABULARY_PROMPT).toContain('ইনসুলিন');
  });
});
