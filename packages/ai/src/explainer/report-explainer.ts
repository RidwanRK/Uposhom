/**
 * Diagnostic Report Explainer with Deterministic Numeric Guard & Glossary Guidance
 *
 * Implements Master Plan section 5 (Report Vault & Explainer):
 * - Explains diagnostic report findings against printed laboratory reference ranges.
 * - Non-LLM Boundary: Flag determination (HIGH, LOW, NORMAL) strictly relies on printed ranges.
 * - Clarifies medical terms from curated 40-test glossary (data/glossary.json).
 * - Safety Invariant: Does NOT provide clinical diagnoses or recommend altered prescription doses.
 * - Always includes explicit mandatory doctor consultation recommendation.
 * - Numeric Guard: Validates that any AI-generated explanation does not fabricate unauthorized numbers.
 */

import { type ReportDetail } from '@uposhom/shared';
import { findGlossaryEntry, determineRangeFlag } from '../vision/report-vault.js';
import { extractNumbers, type NumericGuardResult } from '../guards/numeric-guard.js';

export interface ReportExplanationItem {
  test: string;
  value: string;
  unit: string;
  printedRange: string;
  flag: 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN';
  category: string;
  explanationBn: string;
  isAbnormal: boolean;
  guidanceBn: string;
}

export interface ReportExplainerOptions {
  apiKey?: string;
  useModel?: boolean;
  customSummary?: string;
}

export interface ReportExplanationResult {
  summaryBn: string;
  center: string;
  testType: string;
  date: string;
  totalTests: number;
  abnormalCount: number;
  normalCount: number;
  items: ReportExplanationItem[];
  highFlaggedItems: ReportExplanationItem[];
  lowFlaggedItems: ReportExplanationItem[];
  normalItems: ReportExplanationItem[];
  doctorAdviceBn: string;
  guarded: boolean;
  usedFallback: boolean;
  guardReport?: NumericGuardResult;
}

const MANDATORY_DOCTOR_ADVICE =
  'গুরুত্বপূর্ণ নির্দেশনা: ল্যাব টেস্টের ফলাফলের ভিত্তিতে নিজে থেকে কোনো ওষুধ গ্রহণ, পরিবর্তন বা বন্ধ করবেন না। সঠিক রোগ নির্ণয় এবং প্রয়োজনীয় ব্যবস্থাপনার জন্য সবসময় একজন রেজিস্টার্ড চিকিৎসকের সরাসরি পরামর্শ নিন।';

/**
 * Extracts all valid numeric values from a diagnostic report to populate the numeric guard.
 */
export function extractAllowedNumbersFromReport(report: ReportDetail): Set<string> {
  const allowed = new Set<string>();

  // Standard safe numbers (emergency numbers, timeframes, small indices)
  allowed.add('999');
  allowed.add('24');
  allowed.add('1');
  allowed.add('2');
  allowed.add('3');
  allowed.add('4');
  allowed.add('5');
  allowed.add('6');
  allowed.add('7');
  allowed.add('8');
  allowed.add('9');
  allowed.add('10');

  // Date numbers
  if (report.date) {
    for (const num of extractNumbers(report.date)) {
      allowed.add(num);
    }
  }

  // Report counts
  allowed.add(String(report.values.length));

  // Values and printed ranges
  for (const item of report.values) {
    for (const num of extractNumbers(item.value)) {
      allowed.add(num);
    }
    for (const num of extractNumbers(item.printedRange)) {
      allowed.add(num);
    }
  }

  return allowed;
}

/**
 * Validates AI-generated summary of a diagnostic report against confirmed report values.
 */
export function validateReportNumericOutput(
  aiOutputText: string,
  report: ReportDetail,
): NumericGuardResult {
  const allowedSet = extractAllowedNumbersFromReport(report);
  const numbersInOutput = extractNumbers(aiOutputText);

  const rejected: string[] = [];
  for (const num of numbersInOutput) {
    if (!allowedSet.has(num)) {
      rejected.push(num);
    }
  }

  if (rejected.length > 0) {
    return {
      valid: false,
      rejectedNumbers: rejected,
      extractedNumbersInAiOutput: numbersInOutput,
      allowedNumbers: Array.from(allowedSet),
      fallbackMessageBn: `সতর্কতা: সঠিক তথ্যের সুরক্ষার্থে ল্যাব রিপোর্টের পরীক্ষিত বিবরণ অপরিবর্তিত রাখা হলো।`,
    };
  }

  return {
    valid: true,
    extractedNumbersInAiOutput: numbersInOutput,
    allowedNumbers: Array.from(allowedSet),
  };
}

/**
 * Generates an empathetic, lay-Bangla explanation of a diagnostic laboratory report.
 */
export function explainDiagnosticReport(
  report: ReportDetail,
  options: ReportExplainerOptions = {},
): ReportExplanationResult {
  const items: ReportExplanationItem[] = [];
  const highFlaggedItems: ReportExplanationItem[] = [];
  const lowFlaggedItems: ReportExplanationItem[] = [];
  const normalItems: ReportExplanationItem[] = [];

  for (const val of report.values) {
    // If flag is UNKNOWN, attempt deterministic recalculation against printedRange
    let flag = val.flag;
    if (flag === 'UNKNOWN' && val.printedRange) {
      flag = determineRangeFlag(val.value, val.printedRange);
    }

    const glossary = findGlossaryEntry(val.test);
    const category = glossary?.category || 'General Diagnostic';
    const explanationBn =
      val.explanationBn && val.explanationBn.length > 10
        ? val.explanationBn
        : glossary?.explanationBn ||
          `${val.test} পরীক্ষার ফলাফল স্বাভাবিক সীমার সাথে তুলনা করে মূল্যায়ন করা হয়েছে।`;

    const isAbnormal = flag === 'HIGH' || flag === 'LOW';

    let guidanceBn: string;
    if (flag === 'HIGH') {
      guidanceBn = `স্বাভাবিক মাত্রার চেয়ে বেশি (${val.value} ${val.unit}, স্বাভাবিক রেফারেন্স সীমা: ${val.printedRange})। ফলাফল পর্যালোচনার জন্য চিকিৎসকের পরামর্শ নিন।`;
    } else if (flag === 'LOW') {
      guidanceBn = `স্বাভাবিক মাত্রার চেয়ে কম (${val.value} ${val.unit}, স্বাভাবিক রেফারেন্স সীমা: ${val.printedRange})। ফলাফল পর্যালোচনার জন্য চিকিৎসকের পরামর্শ নিন।`;
    } else {
      guidanceBn = `স্বাভাবিক রেফারেন্স সীমার মধ্যে রয়েছে (${val.value} ${val.unit}, স্বাভাবিক সীমা: ${val.printedRange})।`;
    }

    const item: ReportExplanationItem = {
      test: val.test,
      value: val.value,
      unit: val.unit,
      printedRange: val.printedRange,
      flag,
      category,
      explanationBn,
      isAbnormal,
      guidanceBn,
    };

    items.push(item);
    if (flag === 'HIGH') highFlaggedItems.push(item);
    else if (flag === 'LOW') lowFlaggedItems.push(item);
    else normalItems.push(item);
  }

  const totalTests = items.length;
  const abnormalCount = highFlaggedItems.length + lowFlaggedItems.length;
  const normalCount = normalItems.length;

  // Build deterministic safe explanation template
  let deterministicSummary: string;
  if (abnormalCount > 0) {
    const abnormalNames = [...highFlaggedItems, ...lowFlaggedItems].map((i) => i.test);
    const normalNote = normalCount > 0 ? ` অপর ${normalCount} টি সূচক স্বাভাবিক রয়েছে।` : '';
    deterministicSummary =
      `আপনার ${report.testType} পরীক্ষার (${report.date}) বিশ্লেষণে মোট ${totalTests} টি সূচকের মধ্যে ${abnormalCount} টি সূচকে পরিবর্তন দেখা গেছে: ${abnormalNames.join(', ')}।${normalNote} ` +
      `এটি কোনো চূড়ান্ত রোগ নির্দেশ করে না। সঠিক মূল্যায়ন ও সুপরামর্শের জন্য রিপোর্টটি নিয়ে চিকিৎসকের সাথে যোগাযোগ করুন।`;
  } else {
    deterministicSummary =
      `আপনার ${report.testType} পরীক্ষার (${report.date}) সকল ${totalTests} টি সূচক নির্ধারিত স্বাভাবিক রেফারেন্স সীমার মধ্যে রয়েছে। আপনার শারীরিক সুস্থতা বজায় রাখতে স্বাস্থ্যবিধি মেনে চলুন।`;
  }

  let finalSummary = deterministicSummary;
  let guarded = false;
  let usedFallback = false;
  let guardReport: NumericGuardResult | undefined;

  // If a custom summary or model output was provided, apply strict numeric guard
  if (options.customSummary) {
    guarded = true;
    guardReport = validateReportNumericOutput(options.customSummary, report);
    if (guardReport.valid) {
      finalSummary = options.customSummary;
    } else {
      usedFallback = true;
      finalSummary = deterministicSummary;
    }
  }

  return {
    summaryBn: finalSummary,
    center: report.center,
    testType: report.testType,
    date: report.date,
    totalTests,
    abnormalCount,
    normalCount,
    items,
    highFlaggedItems,
    lowFlaggedItems,
    normalItems,
    doctorAdviceBn: MANDATORY_DOCTOR_ADVICE,
    guarded,
    usedFallback,
    guardReport,
  };
}
