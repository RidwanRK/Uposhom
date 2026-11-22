import { describe, it, expect } from 'vitest';
import {
  processPrescriptionIntake,
  matchBrandInDgda,
  isValidDosagePattern,
} from '../src/vision/intake.js';
import type { UploadAndParseResponse } from '@uposhom/shared';

describe('Vision Intake Pipeline & Brand Matching', () => {
  it('correctly matches Bangladeshi brands against DGDA catalog', () => {
    // English brand
    const napaMatch = matchBrandInDgda('Napa');
    expect(napaMatch.matched).toBe(true);
    expect(napaMatch.drug?.generic).toBe('Paracetamol');

    // Brand with strength/variant
    const extendMatch = matchBrandInDgda('Napa Extend');
    expect(extendMatch.matched).toBe(true);
    expect(extendMatch.drug?.generic).toBe('Paracetamol');

    // Bangla brand name
    const secloBnMatch = matchBrandInDgda('সেকলো');
    expect(secloBnMatch.matched).toBe(true);
    expect(secloBnMatch.drug?.nameEn).toBe('Seclo 20');
    expect(secloBnMatch.drug?.generic).toBe('Omeprazole');

    // Non-existent fictitious brand
    const fakeMatch = matchBrandInDgda('MagicPanaceaXYZ');
    expect(fakeMatch.matched).toBe(false);
  });

  it('validates standard medical dosage pattern syntax', () => {
    // Standard digit slot patterns
    expect(isValidDosagePattern('1+0+1')).toBe(true);
    expect(isValidDosagePattern('1-0-1')).toBe(true);
    expect(isValidDosagePattern('1+1+1')).toBe(true);
    expect(isValidDosagePattern('0+0+1')).toBe(true);
    expect(isValidDosagePattern('1+0+0')).toBe(true);
    expect(isValidDosagePattern('1/2+0+1/2')).toBe(true);
    expect(isValidDosagePattern('½+0+½')).toBe(true);

    // Standard Latin abbreviations
    expect(isValidDosagePattern('OD')).toBe(true);
    expect(isValidDosagePattern('BD')).toBe(true);
    expect(isValidDosagePattern('TDS')).toBe(true);
    expect(isValidDosagePattern('QDS')).toBe(true);
    expect(isValidDosagePattern('PRN')).toBe(true);

    // Invalid nonsense
    expect(isValidDosagePattern('Drink plenty of juice')).toBe(false);
    expect(isValidDosagePattern('as needed whenever')).toBe(false);
  });

  it('processes valid prescription intake without discrepancies', async () => {
    const validFixture: UploadAndParseResponse = {
      draftPrescriptionId: 'draft-test-001',
      transcribedText: 'Tab. Napa Extend 665mg 1+0+1 BDPC 5 days\nCap. Seclo 20mg 1+0+1 AC 14 days',
      extractedItems: [
        {
          tempId: 'item-1',
          brandName: 'Napa Extend',
          strength: '665mg',
          form: 'Tablet',
          pattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 5,
          confidence: 0.96,
        },
        {
          tempId: 'item-2',
          brandName: 'Seclo',
          strength: '20mg',
          form: 'Capsule',
          pattern: '1+0+1',
          mealRelation: 'AC',
          durationDays: 14,
          confidence: 0.94,
        },
      ],
    };

    const result = await processPrescriptionIntake('mock://prescription-image.webp', {
      mockFixture: validFixture,
    });

    expect(result.draftPrescriptionId).toBe('draft-test-001');
    expect(result.extractedItems).toHaveLength(2);
    expect(result.hasNumericDiscrepancies).toBe(false);
    const item0 = result.extractedItems[0]!;
    expect(item0.isBrandVerifiedInDgda).toBe(true);
    expect(item0.genericName).toBe('Paracetamol');
    expect(item0.numericDiscrepancy).toBe(false);
    expect(item0.requiresManualReview).toBe(false);
    expect(result.overallConfidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects altered OCR dosage numbers and flags numeric discrepancy', async () => {
    // In this fixture, the raw transcription says "Tab. Napa 500mg 1+0+1 5 days"
    // BUT the OCR model hallucinates/alters strength to "1000mg" and duration to "30 days"
    const alteredFixture: UploadAndParseResponse = {
      draftPrescriptionId: 'draft-altered-002',
      transcribedText: 'Tab. Napa 500mg 1+0+1 BDPC 5 days',
      extractedItems: [
        {
          tempId: 'item-1',
          brandName: 'Napa',
          strength: '1000mg', // Discrepancy! '1000' is not in transcribedText
          form: 'Tablet',
          pattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 30, // Discrepancy! '30' is not in transcribedText
          confidence: 0.95,
        },
      ],
    };

    const result = await processPrescriptionIntake('mock://altered.webp', {
      mockFixture: alteredFixture,
    });

    expect(result.hasNumericDiscrepancies).toBe(true);
    const item = result.extractedItems[0]!;
    expect(item.numericDiscrepancy).toBe(true);
    expect(item.discrepancyDetails.length).toBeGreaterThanOrEqual(1);
    // Confidence is drastically downgraded to ensure caregiver/user review
    expect(item.confidence).toBeLessThanOrEqual(0.4);
    expect(item.requiresManualReview).toBe(true);
    expect(result.requiresReviewCount).toBe(1);
  });

  it('flags unverified brands and low confidence items for manual review', async () => {
    const unverifiedFixture: UploadAndParseResponse = {
      draftPrescriptionId: 'draft-unverified-003',
      transcribedText: 'Tab. UnknownHerbalMedicine 50mg 1+0+1 7 days',
      extractedItems: [
        {
          tempId: 'item-1',
          brandName: 'UnknownHerbalMedicine',
          strength: '50mg',
          form: 'Tablet',
          pattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 7,
          confidence: 0.85,
        },
      ],
    };

    const result = await processPrescriptionIntake('mock://unknown.webp', {
      mockFixture: unverifiedFixture,
    });

    const item = result.extractedItems[0]!;
    expect(item.isBrandVerifiedInDgda).toBe(false);
    expect(item.requiresManualReview).toBe(true);
    expect(item.confidence).toBeLessThanOrEqual(0.7);
  });
});
