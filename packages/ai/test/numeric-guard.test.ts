import { describe, it, expect } from 'vitest';
import {
  validateAiNumericOutput,
  normalizeDigits,
  extractNumbers,
  extractAllowedNumbersFromItems,
} from '../src/guards/numeric-guard.js';
import type { ConfirmItem } from '@uposhom/shared';

describe('Deterministic Numeric Dosage Sanity Guard', () => {
  const sampleConfirmedItems: ConfirmItem[] = [
    {
      brandName: 'Napa Extend',
      dosageStrength: '665mg',
      form: 'Tablet',
      parsedPattern: '1+0+1',
      mealRelation: 'PC',
      durationDays: 5,
      isCritical: false,
      pillCount: 10,
    },
    {
      brandName: 'Camlod',
      dosageStrength: '5mg',
      form: 'Tablet',
      parsedPattern: '1+0+0',
      mealRelation: 'PC',
      durationDays: 30,
      isCritical: true,
      pillCount: 30,
    },
  ];

  it('normalizes Bangla digits and fractions correctly', () => {
    expect(normalizeDigits('১+০+১')).toBe('1+0+1');
    expect(normalizeDigits('৬৬৫ মিলি')).toBe('665 মিলি');
    expect(normalizeDigits('½ চামচ')).toBe('0.5 চামচ');
    expect(normalizeDigits('১/২ চামচ')).toBe('0.5 চামচ');
  });

  it('extracts unique numbers from text', () => {
    const nums = extractNumbers('সকালে 1 টি, দুপুরে 0 টি, রাতে 1 টি করে মোট 665mg ৫ দিন');
    expect(nums).toContain('1');
    expect(nums).toContain('0');
    expect(nums).toContain('665');
    expect(nums).toContain('5');
  });

  it('builds allowed numbers set from confirmed items', () => {
    const allowed = extractAllowedNumbersFromItems(sampleConfirmedItems);
    expect(allowed.has('665')).toBe(true);
    expect(allowed.has('5')).toBe(true);
    expect(allowed.has('1')).toBe(true);
    expect(allowed.has('0')).toBe(true);
    expect(allowed.has('30')).toBe(true);
    expect(allowed.has('10')).toBe(true);
    expect(allowed.has('999')).toBe(true); // Emergency whitelist
  });

  it('approves AI explanation when numbers match confirmed data exactly', () => {
    const validAiText =
      'আপনার জন্য Napa Extend 665mg ট্যাবলেট দিনে ১+০+১ (সকালে ১টি ও রাতে ১টি) ভরা পেটে ৫ দিন খেতে বলা হয়েছে। এবং Camlod 5mg ট্যাবলেট সকালে ১+০+০ করে ৩০ দিন চলবে।';

    const result = validateAiNumericOutput(validAiText, sampleConfirmedItems);
    expect(result.valid).toBe(true);
    expect(result.rejectedNumbers).toBeUndefined();
  });

  it('rejects AI output when hallucinated or altered dosage numbers are detected', () => {
    // Notice: 1000mg instead of 665mg, and 2+0+2 instead of 1+0+1
    const alteredAiText =
      'আপনার Napa Extend 1000mg ট্যাবলেট দিনে ২+০+২ করে খেতে হবে।';

    const result = validateAiNumericOutput(alteredAiText, sampleConfirmedItems);
    expect(result.valid).toBe(false);
    expect(result.rejectedNumbers).toContain('1000');
    expect(result.rejectedNumbers).toContain('2');
    expect(result.fallbackMessageBn).toBeDefined();
    expect(result.fallbackMessageBn).toContain('Napa Extend');
    expect(result.fallbackMessageBn).toContain('665mg');
  });

  it('rejects AI output when unapproved duration days are stated', () => {
    // Notice: 14 days instead of 5 days
    const alteredDurationText =
      'Napa Extend 665mg ওষুধটি আপনি টানা ১৪ দিন সেবন করবেন।';

    const result = validateAiNumericOutput(alteredDurationText, sampleConfirmedItems);
    expect(result.valid).toBe(false);
    expect(result.rejectedNumbers).toContain('14');
  });
});
