/**
 * Deterministic Numeric Dosage Sanity Guard
 *
 * Core Safety Principle: AI Bangla explanations must NEVER fabricate, hallucinate,
 * or alter dosage numbers. If any number in the generated text was not present in the
 * confirmed prescription items, the output is rejected and replaced by a safe deterministic template.
 */

import type { ConfirmItem } from '@uposhom/shared';

export interface NumericGuardResult {
  valid: boolean;
  rejectedNumbers?: string[];
  extractedNumbersInAiOutput?: string[];
  allowedNumbers?: string[];
  fallbackMessageBn?: string;
}

const BANGLA_TO_LATIN_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

/**
 * Normalizes text containing Bangla digits and fractions to standard Latin representation.
 */
export function normalizeDigits(text: string): string {
  let result = text.replace(/[০-৯]/g, (char) => BANGLA_TO_LATIN_DIGITS[char] ?? char);
  // Normalize fractions
  result = result.replace(/½/g, '0.5');
  result = result.replace(/১\/২/g, '0.5');
  result = result.replace(/1\/2/g, '0.5');
  return result;
}

/**
 * Extracts all distinct numerical values (integers or decimals) from a string.
 */
export function extractNumbers(text: string): string[] {
  const normalized = normalizeDigits(text);
  const matches = normalized.match(/\d+(\.\d+)?/g);
  if (!matches) return [];
  // Return distinct sorted numbers
  return Array.from(new Set(matches));
}

/**
 * Extracts all valid numerical values from confirmed prescription items.
 */
export function extractAllowedNumbersFromItems(items: ConfirmItem[]): Set<string> {
  const allowed = new Set<string>();

  // Standard safe medical numbers that might appear in instructions
  // e.g., 24 hours, 999 emergency, 60 minutes, 30 minutes offset, 15 minutes
  allowed.add('999');
  allowed.add('24');
  allowed.add('30'); // meal offset in minutes
  allowed.add('15'); // snooze/meal offset

  for (const item of items) {
    // Numbers from strength (e.g. 500, 665, 20)
    for (const n of extractNumbers(item.dosageStrength)) {
      allowed.add(n);
    }
    // Numbers from pattern (e.g. 1, 0, 1, 0.5)
    for (const n of extractNumbers(item.parsedPattern)) {
      allowed.add(n);
    }
    // Duration in days
    allowed.add(String(item.durationDays));

    // Pill count if present
    if (item.pillCount) {
      allowed.add(String(item.pillCount));
    }
  }

  return allowed;
}

/**
 * Validates AI explanation output against confirmed prescription data.
 * Rejects output if any unauthorized dosage numbers are found.
 */
export function validateAiNumericOutput(
  aiOutputText: string,
  confirmedItems: ConfirmItem[],
): NumericGuardResult {
  const allowedSet = extractAllowedNumbersFromItems(confirmedItems);
  const numbersInOutput = extractNumbers(aiOutputText);

  const rejected: string[] = [];

  for (const num of numbersInOutput) {
    if (!allowedSet.has(num)) {
      rejected.push(num);
    }
  }

  if (rejected.length > 0) {
    // Build safe fallback explanation template
    const fallbackMessageBn = confirmedItems
      .map((item) => {
        const mealText =
          item.mealRelation === 'AC'
            ? 'খাবার পূর্বে (খালি পেটে)'
            : item.mealRelation === 'PC'
              ? 'খাবার পর (ভরা পেটে)'
              : item.mealRelation === 'WITH_MEAL'
                ? 'খাবারের সাথে'
                : 'নির্দেশনা অনুযায়ী';
        return `• ${item.brandName} (${item.dosageStrength}): ${item.parsedPattern}, ${mealText}, ${item.durationDays} দিন।`;
      })
      .join('\n');

    return {
      valid: false,
      rejectedNumbers: rejected,
      extractedNumbersInAiOutput: numbersInOutput,
      allowedNumbers: Array.from(allowedSet),
      fallbackMessageBn: `সতর্কতা: সঠিক তথ্যের সুরক্ষার্থে প্রেসক্রিপশনের নিশ্চিত বিবরণ নিচে তুলে ধরা হলো:\n${fallbackMessageBn}\nযেকোনো প্রয়োজনে আপনার ডাক্তারের পরামর্শ নিন।`,
    };
  }

  return {
    valid: true,
    extractedNumbersInAiOutput: numbersInOutput,
    allowedNumbers: Array.from(allowedSet),
  };
}
