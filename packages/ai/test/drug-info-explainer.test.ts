import { describe, it, expect } from 'vitest';
import {
  getDrugInfoForBrand,
  buildExplainerItemCards,
  generateDeterministicExplanation,
  generatePrescriptionExplanation,
} from '../src/explainer/index.js';
import type { ConfirmItem } from '@uposhom/shared';

describe('Curated Drug Info & Explainer Pipeline', () => {
  it('loads curated drug info for registered DGDA brands', () => {
    const napaInfo = getDrugInfoForBrand('Napa');
    expect(napaInfo).not.toBeNull();
    expect(napaInfo?.generic).toBe('Paracetamol');
    expect(napaInfo?.purposeBn).toContain('জ্বর');
    expect(napaInfo?.precautionsBn).toContain('লিভার');

    const secloInfo = getDrugInfoForBrand('Seclo 20');
    expect(secloInfo).not.toBeNull();
    expect(secloInfo?.generic).toBe('Omeprazole');
    expect(secloInfo?.purposeBn).toContain('গ্যাস');
    expect(secloInfo?.instructionsBn).toContain('খালি পেটে');
  });

  it('builds structured explainer cards with purpose and precautions', () => {
    const items: ConfirmItem[] = [
      {
        brandName: 'Napa Extend',
        dosageStrength: '665mg',
        form: 'Tablet',
        parsedPattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 5,
        isCritical: false,
      },
      {
        brandName: 'Seclo 20',
        dosageStrength: '20mg',
        form: 'Capsule',
        parsedPattern: '1+0+1',
        mealRelation: 'AC',
        durationDays: 14,
        isCritical: false,
      },
    ];

    const cards = buildExplainerItemCards(items);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.brandName).toBe('Napa Extend');
    expect(cards[0]!.purposeBn).toBeDefined();
    expect(cards[0]!.mealBn).toContain('খাবার পর');

    expect(cards[1]!.brandName).toBe('Seclo 20');
    expect(cards[1]!.purposeBn).toBeDefined();
    expect(cards[1]!.mealBn).toContain('খাবার ৩০ মিনিট আগে');
  });

  it('generates rich deterministic explanation with clinical advice and zero hallucination', () => {
    const items: ConfirmItem[] = [
      {
        brandName: 'Napa Extend',
        dosageStrength: '665mg',
        form: 'Tablet',
        parsedPattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 5,
        isCritical: false,
      },
    ];

    const explanation = generateDeterministicExplanation(items);
    expect(explanation).toContain('Napa Extend');
    expect(explanation).toContain('কাজের ধরন');
    expect(explanation).toContain('সকালে ১টি ও রাতে ১টি');
    expect(explanation).toContain('খাবার পর');
    expect(explanation).toContain('চিকিৎসকের পরামর্শ');
  });

  it('strictly rejects AI generated text that hallucinates unapproved dosages', async () => {
    const items: ConfirmItem[] = [
      {
        brandName: 'Napa Extend',
        dosageStrength: '665mg',
        form: 'Tablet',
        parsedPattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 5,
        isCritical: false,
      },
    ];

    // Hallucinates 800mg strength and 25 days duration
    const hallucinatedText =
      'আপনার Napa Extend 800mg ট্যাবলেট দিনে ১+০+১ করে মোট ২৫ দিন চলবে।';

    const result = await generatePrescriptionExplanation(items, {
      customExplanation: hallucinatedText,
    });

    expect(result.guarded).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.rejectedNumbers).toContain('800');
    expect(result.rejectedNumbers).toContain('25');
    expect(result.explanationBn).toContain('সতর্কতা: সঠিক তথ্যের সুরক্ষার্থে');
  });
});
