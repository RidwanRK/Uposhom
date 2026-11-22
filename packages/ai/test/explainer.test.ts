import { describe, it, expect } from 'vitest';
import {
  generateDeterministicExplanation,
  generatePrescriptionExplanation,
  formatPatternInBangla,
  formatMealRelationInBangla,
} from '../src/explainer/index.js';
import type { ConfirmItem } from '@uposhom/shared';

describe('Prescription Explainer & Strict Numeric Guard', () => {
  const confirmedItems: ConfirmItem[] = [
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
      brandName: 'Seclo',
      dosageStrength: '20mg',
      form: 'Capsule',
      parsedPattern: '1+0+1',
      mealRelation: 'AC',
      durationDays: 14,
      isCritical: false,
      pillCount: 28,
    },
  ];

  it('formats dosage pattern and meal relations into friendly lay-Bangla', () => {
    expect(formatPatternInBangla('1+0+1')).toBe('সকালে ১টি ও রাতে ১টি');
    expect(formatPatternInBangla('1+1+1')).toBe('সকালে ১টি, দুপুরে ১টি ও রাতে ১টি');
    expect(formatPatternInBangla('½+0+½')).toBe('সকালে অর্ধেক (০.৫) ও রাতে অর্ধেক (০.৫)');
    expect(formatMealRelationInBangla('AC')).toContain('খাবার ৩০ মিনিট আগে');
    expect(formatMealRelationInBangla('PC')).toContain('খাবার পর');
  });

  it('generates safe deterministic explanation containing only verified prescription data', () => {
    const text = generateDeterministicExplanation(confirmedItems);
    expect(text).toContain('Napa Extend');
    expect(text).toContain('665mg');
    expect(text).toContain('সকালে ১টি ও রাতে ১টি');
    expect(text).toContain('Seclo');
    expect(text).toContain('20mg');
    expect(text).toContain('খাবার ৩০ মিনিট আগে');
    expect(text).toContain('চিকিৎসকের পরামর্শ');
  });

  it('accepts safe AI explanations with verified numbers', async () => {
    const safeAiExplanation =
      'আপনার প্রেসক্রিপশনের Napa Extend 665mg ট্যাবলেট দিনে দুইবার (সকালে ১ ও রাতে ১) খাবার পর মোট ৫ দিন খাবেন। ' +
      'এবং Seclo 20mg ক্যাপসুল দিনে দুইবার খাবার ৩০ মিনিট পূর্বে ১৪ দিন খাবেন। জরুরি প্রয়োজনে ৯৯৯ নম্বরে যোগাযোগ করবেন।';

    const result = await generatePrescriptionExplanation(confirmedItems, {
      customExplanation: safeAiExplanation,
    });

    expect(result.guarded).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.explanationBn).toBe(safeAiExplanation);
    expect(result.guardReport.valid).toBe(true);
  });

  it('rejects AI explanation that hallucinates altered dosage numbers', async () => {
    // Hallucinating 500mg, 3 tablets, and 90 days when only 665mg, 1+0+1, and 5 days are confirmed
    const hallucinatedExplanation =
      'আপনার Napa Extend 500mg ওষুধটি দিনে ৩ বার খাবেন এবং মোট ৯০ দিন চালিয়ে যাবেন।';

    const result = await generatePrescriptionExplanation(confirmedItems, {
      customExplanation: hallucinatedExplanation,
    });

    expect(result.guarded).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.rejectedNumbers).toContain('500');
    expect(result.rejectedNumbers).toContain('3');
    expect(result.rejectedNumbers).toContain('90');
    // Explainer immediately drops hallucination and falls back to safe template
    expect(result.explanationBn).toContain('সতর্কতা: সঠিক তথ্যের সুরক্ষার্থে প্রেসক্রিপশনের নিশ্চিত বিবরণ নিচে তুলে ধরা হলো');
    expect(result.explanationBn).toContain('Napa Extend (665mg)');
  });
});
