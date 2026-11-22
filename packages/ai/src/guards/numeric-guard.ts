import type { ConfirmItem } from '@uposhom/shared';

/**
 * Deterministic Numeric Dosage Sanity Guard
 *
 * CRITICAL SAFETY REQUIREMENT (Master Plan Section 6 & 7):
 * AI Bangla explanations MUST BE REJECTED if any dosage number differs
 * from the confirmed prescription item.
 *
 * Prevents hallucinated dose amounts, frequency errors, or duration drift.
 */

export interface NumericGuardResult {
  valid: boolean;
  rejectedNumbers?: string[];
  authorizedNumbers?: string[];
  extractedNumbers?: string[];
  fallbackMessageBn?: string;
}

const BANGLA_TO_ASCII_DIGIT_MAP: Record<string, string> = {
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

// Safe system constants permitted in explanations (e.g. emergency hotline, hour markers)
const SYSTEM_WHITELISTED_NUMBERS = new Set<string>([
  '999', // Emergency hotline
  '16263', // Shastho Batayon Bangladesh national health helpline
  '24', // Hours in a day (e.g. 24 ঘণ্টা)
]);

/**
 * Normalizes text by converting all Bangla digits to ASCII digits.
 */
export function normalizeBanglaDigits(text: string): string {
  return text.replace(/[০-৯]/g, (char) => BANGLA_TO_ASCII_DIGIT_MAP[char] || char);
}

/**
 * Extracts all unique whole numbers and decimal numbers from text.
 */
export function extractNumbers(text: string): string[] {
  const normalized = normalizeBanglaDigits(text);
  // Match integer or decimal numbers or fraction ½
  const matches = normalized.match(/\b\d+(\.\d+)?\b|½/g);
  if (!matches) return [];
  // Return distinct string representations
  return Array.from(new Set(matches));
}

/**
 * Collects all authorized numbers from confirmed prescription items.
 */
export function getAuthorizedNumbers(items: ConfirmItem[]): Set<string> {
  const authorized = new Set<string>(SYSTEM_WHITELISTED_NUMBERS);

  for (const item of items) {
    // 1. Numbers from strength (e.g. "500mg" -> "500", "500mg+200IU" -> "500", "200")
    const strengthNumbers = extractNumbers(item.dosageStrength);
    for (const num of strengthNumbers) authorized.add(num);

    // 2. Numbers from pattern (e.g. "1+0+1" -> "1", "0", "1")
    const patternNumbers = extractNumbers(item.parsedPattern);
    for (const num of patternNumbers) authorized.add(num);

    // 3. Duration days (e.g. 5, 14, 30)
    authorized.add(String(item.durationDays));

    // 4. Pill count if present
    if (item.pillCount !== undefined) {
      authorized.add(String(item.pillCount));
    }
  }

  return authorized;
}

/**
 * Deterministic template fallback when AI generation fails the numeric guard.
 */
export function generateSafePrescriptionSummaryBn(items: ConfirmItem[]): string {
  const lines = items.map((item, idx) => {
    const mealText =
      item.mealRelation === 'BEFORE_MEAL'
        ? 'খাবার পূর্বে'
        : item.mealRelation === 'AFTER_MEAL'
          ? 'খাবার পরে'
          : item.mealRelation === 'EMPTY_STOMACH'
            ? 'খালি পেটে'
            : item.mealRelation === 'WITH_MEAL'
              ? 'খাবারের সাথে'
              : '';

    return `${idx + 1}. ${item.brandName} (${item.dosageStrength}): ${item.parsedPattern} ${mealText} (${item.durationDays} দিন)${item.isCritical ? ' [জরুরি ঔষধ]' : ''}`;
  });

  return `আপনার চিকিৎসকের প্রেসক্রিপশন অনুযায়ী ঔষধের তালিকা:\n${lines.join('\n')}\n\nসতর্কতা: সঠিক সময়ে নিয়মিত ঔষধ সেবন করুন। কোনো সমস্যায় চিকিৎসকের পরামর্শ নিন।`;
}

/**
 * Validates AI output against confirmed items.
 * If AI output contains any unauthorized number, it is strictly rejected.
 */
export function validateAiNumericGuard(
  aiOutputText: string,
  confirmedItems: ConfirmItem[],
): NumericGuardResult {
  const authorizedSet = getAuthorizedNumbers(confirmedItems);
  const extractedNumbers = extractNumbers(aiOutputText);

  const rejectedNumbers: string[] = [];

  for (const num of extractedNumbers) {
    if (!authorizedSet.has(num)) {
      rejectedNumbers.push(num);
    }
  }

  if (rejectedNumbers.length > 0) {
    return {
      valid: false,
      rejectedNumbers,
      authorizedNumbers: Array.from(authorizedSet),
      extractedNumbers,
      fallbackMessageBn: generateSafePrescriptionSummaryBn(confirmedItems),
    };
  }

  return {
    valid: true,
    authorizedNumbers: Array.from(authorizedSet),
    extractedNumbers,
  };
}
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
