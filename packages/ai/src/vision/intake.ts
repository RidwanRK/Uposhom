/**
 * Prescription Vision Intake Pipeline
 *
 * Integrates:
 * 1. OpenRouter Vision OCR (extractPrescriptionVision)
 * 2. Brand validation & fuzzy match against local DGDA drug catalog
 * 3. Dosage pattern syntax verification
 * 4. Deterministic Numeric Guard: validates extracted numbers against raw transcribed text
 * 5. Low-confidence highlighting (< 0.75) for mobile side-by-side visual confirm screen
 */

import {
  type ExtractedItem,
  uploadAndParseResponse,
} from '@uposhom/shared';
import { extractPrescriptionVision, type OcrExtractionOptions } from './ocr-extract.js';
import { extractNumbers, normalizeDigits } from '../guards/numeric-guard.js';
import { type DgdaDrugRecord } from '../agents/generic-agent.js';
import { matchBrand } from '../matching/brand-matcher.js';

export interface IntakeItemValidation extends ExtractedItem {
  isBrandVerifiedInDgda: boolean;
  matchedDgdaDrugId?: string;
  isPatternValid: boolean;
  numericDiscrepancy: boolean;
  discrepancyDetails: string[];
  requiresManualReview: boolean;
}

export interface PrescriptionIntakeResult {
  draftPrescriptionId: string;
  transcribedText: string;
  extractedItems: IntakeItemValidation[];
  overallConfidence: number;
  hasLowConfidenceItems: boolean;
  hasNumericDiscrepancies: boolean;
  requiresReviewCount: number;
}

/**
 * Validates a brand name against DGDA catalog using exact, alias and trigram matching.
 */
export function matchBrandInDgda(brandName: string): {
  matched: boolean;
  drug?: DgdaDrugRecord;
  score?: number;
} {
  const result = matchBrand(brandName);
  return {
    matched: result.matched,
    drug: result.bestMatch?.drug,
    score: result.bestMatch?.score,
  };
}

/**
 * Checks whether a dosage pattern conforms to recognized medical syntaxes:
 * (e.g. 1+0+1, 1-0-1, 1+1+1, 0+0+1, 1+0+0, 1/2+0+1/2, ½+0+½, OD, BD, TDS, QDS, PRN, etc.)
 */
export function isValidDosagePattern(pattern: string): boolean {
  const normalized = normalizeDigits(pattern.trim().toUpperCase());

  // Check standard numeric slot format: e.g. 1+0+1 or 1-0-1 or 0.5+0+0.5
  const slotPattern = /^(\d+(\.\d+)?|\d+\/\d+)(\+|-)(\d+(\.\d+)?|\d+\/\d+)((\+|-)(\d+(\.\d+)?|\d+\/\d+))?((\+|-)(\d+(\.\d+)?|\d+\/\d+))?$/;
  if (slotPattern.test(normalized)) {
    return true;
  }

  // Standard Latin medical frequency abbreviations
  const knownAbbreviations = [
    'OD',
    'BD',
    'BID',
    'TDS',
    'TID',
    'QDS',
    'QID',
    'HS',
    'PRN',
    'SOS',
    'STAT',
    'ONCE DAILY',
    'TWICE DAILY',
    'THRICE DAILY',
  ];
  if (knownAbbreviations.includes(normalized)) {
    return true;
  }

  return false;
}

/**
 * Runs the full Vision Intake pipeline on a prescription image.
 */
export async function processPrescriptionIntake(
  imageDataUriOrUrl: string,
  options: OcrExtractionOptions = {},
): Promise<PrescriptionIntakeResult> {
  // Step 1: OpenRouter Vision Extraction
  const rawParseResult = await extractPrescriptionVision(imageDataUriOrUrl, options);

  // Validate schema
  const parsed = uploadAndParseResponse.parse(rawParseResult);
  const transcribedNumbers = new Set(extractNumbers(parsed.transcribedText));

  let totalConfidence = 0;
  let hasLowConfidence = false;
  let hasDiscrepancy = false;
  let reviewCount = 0;

  const validatedItems: IntakeItemValidation[] = [];

  // Step 2: Validate each item
  for (const item of parsed.extractedItems) {
    const discrepancyDetails: string[] = [];
    let numericDiscrepancy = false;

    // Check numeric consistency: verify all extracted numbers exist in the raw transcribed text
    const itemNumbers = [
      ...extractNumbers(item.strength),
      ...extractNumbers(item.pattern),
      String(item.durationDays),
      ...(item.pillCount ? [String(item.pillCount)] : []),
    ];

    for (const num of itemNumbers) {
      if (!transcribedNumbers.has(num)) {
        numericDiscrepancy = true;
        discrepancyDetails.push(
          `Extracted number '${num}' in item '${item.brandName}' was not found in raw transcribed text`,
        );
      }
    }

    // Match brand in DGDA database
    const brandMatch = matchBrandInDgda(item.brandName);
    const isBrandVerified = brandMatch.matched;
    const isPatternValid = isValidDosagePattern(item.pattern);

    // Adjust confidence if issues detected
    let confidence = item.confidence;
    if (numericDiscrepancy) {
      confidence = Math.min(confidence, 0.4);
      hasDiscrepancy = true;
    }
    if (!isBrandVerified) {
      confidence = Math.min(confidence, 0.7);
    }
    if (!isPatternValid) {
      confidence = Math.min(confidence, 0.6);
    }

    const requiresReview =
      confidence < 0.75 || numericDiscrepancy || !isBrandVerified || !isPatternValid;

    if (requiresReview) {
      reviewCount++;
      hasLowConfidence = true;
    }

    totalConfidence += confidence;

    validatedItems.push({
      ...item,
      genericName: item.genericName || brandMatch.drug?.generic,
      confidence,
      isBrandVerifiedInDgda: isBrandVerified,
      matchedDgdaDrugId: brandMatch.drug?.id,
      isPatternValid,
      numericDiscrepancy,
      discrepancyDetails,
      requiresManualReview: requiresReview,
    });
  }

  const overallConfidence =
    validatedItems.length > 0
      ? Number((totalConfidence / validatedItems.length).toFixed(2))
      : 0;

  return {
    draftPrescriptionId: parsed.draftPrescriptionId,
    transcribedText: parsed.transcribedText,
    extractedItems: validatedItems,
    overallConfidence,
    hasLowConfidenceItems: hasLowConfidence,
    hasNumericDiscrepancies: hasDiscrepancy,
    requiresReviewCount: reviewCount,
  };
}
