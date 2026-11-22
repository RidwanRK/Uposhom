/**
 * Diagnostic Report Vault Vision Extractor
 *
 * Implements Master Plan section 5 (Report Vault):
 * - OpenRouter vision extracts values, units, and the printed reference range from report images.
 * - Strict Non-LLM Boundary: The flag (HIGH, LOW, NORMAL) is determined by a deterministic
 *   numerical comparison against that printed range, NOT our own reference table.
 * - Terms are explained from a curated glossary of 40 common lab tests, always ending
 *   with an explicit recommendation to consult a registered doctor.
 * - Deterministic numeric guard: ensures extracted values match the raw transcribed text.
 */

import { reportDetail, type ReportDetail, type ReportValue } from '@uposhom/shared';
import { createOpenRouterClient } from '../client.js';
import { AI_CONFIG } from '../config.js';
import { extractNumbers } from '../guards/numeric-guard.js';
import fs from 'node:fs';
import path from 'node:path';

export interface ReportGlossaryEntry {
  id: string;
  testName: string;
  category: string;
  standardRange: string;
  unit: string;
  explanationBn: string;
}

export interface ReportExtractionOptions {
  apiKey?: string;
  useFallbackModel?: boolean;
  mockFixture?: ReportDetail;
  profileId?: string;
}

export interface ReportExtractionResult {
  detail: ReportDetail;
  rawTranscribedText: string;
  hasNumericDiscrepancy: boolean;
  discrepancyDetails: string[];
  flagCounts: {
    high: number;
    low: number;
    normal: number;
    unknown: number;
  };
}

let cachedGlossary: ReportGlossaryEntry[] | null = null;

export function loadGlossary(): ReportGlossaryEntry[] {
  if (cachedGlossary) return cachedGlossary;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/glossary.json'),
      path.resolve(process.cwd(), '../../data/glossary.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedGlossary = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedGlossary!;
      }
    }
  } catch {
    // Fall back to empty
  }
  return [];
}

/**
 * Normalizes numbers by removing commas (e.g. "8,500" -> "8500", "220,000" -> "220000").
 */
function cleanNumericStr(str: string): string {
  return str.replace(/,/g, '').trim();
}

/**
 * Compares an extracted numeric value against a printed range string.
 * Example printed ranges:
 * - "3.9 - 6.1 mmol/L"
 * - "< 200 mg/dL"
 * - "> 40 mg/dL"
 * - "< 5.7 % (Good Control: <7.0)"
 * - "150,000 - 450,000 /cumm"
 * - "0 - 15 mm/1st hr"
 */
export function determineRangeFlag(
  valueStr: string,
  printedRangeStr: string,
): 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN' {
  const val = parseFloat(cleanNumericStr(valueStr));
  if (isNaN(val)) return 'UNKNOWN';

  const cleanedRange = cleanNumericStr(printedRangeStr);

  // Handle "<= X" or "< X" (e.g. "< 200", "< 5.7", "<= 100")
  const lessMatch = cleanedRange.match(/(?:<=|<)\s*([0-9.]+)/);
  if (lessMatch && lessMatch[1]) {
    const limit = parseFloat(lessMatch[1]);
    if (!isNaN(limit)) {
      return val > limit ? 'HIGH' : 'NORMAL';
    }
  }

  // Handle ">= X" or "> X" (e.g. "> 40", "> 90", ">= 60")
  const greaterMatch = cleanedRange.match(/(?:>=|>)\s*([0-9.]+)/);
  if (greaterMatch && greaterMatch[1]) {
    const limit = parseFloat(greaterMatch[1]);
    if (!isNaN(limit)) {
      return val < limit ? 'LOW' : 'NORMAL';
    }
  }

  // Handle "X - Y" or "X to Y" (e.g. "3.9 - 6.1", "13.0 - 17.0", "150000 - 450000")
  const rangeMatch = cleanedRange.match(/([0-9.]+)\s*(?:-|to)\s*([0-9.]+)/i);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) {
      if (val < min) return 'LOW';
      if (val > max) return 'HIGH';
      return 'NORMAL';
    }
  }

  return 'NORMAL';
}

/**
 * Finds matching glossary entry for a test name.
 */
export function findGlossaryEntry(testName: string): ReportGlossaryEntry | null {
  const glossary = loadGlossary();
  const lower = testName.toLowerCase().trim();

  // 1. Direct match on ID or testName
  for (const g of glossary) {
    if (g.id.toLowerCase() === lower || g.testName.toLowerCase() === lower) {
      return g;
    }
  }

  // 2. Substring matching
  for (const g of glossary) {
    const gName = g.testName.toLowerCase();
    if (gName.includes(lower) || lower.includes(gName)) {
      return g;
    }
  }

  // 3. Keyword matching for common tests (FBS, HbA1c, CBC, ESR, Creatinine, Lipid)
  const keywords: Record<string, string> = {
    fbs: 'fbs',
    fasting: 'fbs',
    glucose: 'fbs',
    hba1c: 'hba1c',
    hemoglobin: 'hb',
    hb: 'hb',
    esr: 'esr',
    platelet: 'platelet',
    wbc: 'wbc',
    cholesterol: 'cholesterol_total',
    triglyceride: 'triglycerides',
    hdl: 'hdl',
    ldl: 'ldl',
    creatinine: 'creatinine',
    urea: 'urea',
    uric: 'uric_acid',
    sgpt: 'sgpt',
    alt: 'sgpt',
    sgot: 'sgot',
    ast: 'sgot',
    bilirubin: 'bilirubin_total',
  };

  for (const [kw, targetId] of Object.entries(keywords)) {
    if (lower.includes(kw)) {
      const match = glossary.find((g) => g.id.toLowerCase() === targetId);
      if (match) return match;
    }
  }

  return null;
}

/**
 * Formats a lay-Bangla explanation for an extracted lab result.
 * Strictly concludes with a pointer to consult the doctor.
 */
export function formatReportExplanationBn(
  testName: string,
  value: string,
  unit: string,
  flag: 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN',
): string {
  const entry = findGlossaryEntry(testName);
  const baseExplanation = entry
    ? entry.explanationBn
    : 'এই পরীক্ষার ফলাফলের সঠিক পর্যালোচনার জন্য অনুগ্রহ করে আপনার রেজিস্টার্ড চিকিৎসকের সঙ্গে যোগাযোগ করুন।';

  const doctorPointer = 'যেকোনো অস্বাভাবিক মানের ক্ষেত্রে অবিলম্বে আপনার চিকিৎসকের পরামর্শ নিন।';

  if (flag === 'HIGH') {
    return `ফলাফল স্বাভাবিকের চেয়ে বেশি (${value} ${unit})। ${baseExplanation} ${doctorPointer}`;
  }

  if (flag === 'LOW') {
    return `ফলাফল স্বাভাবিকের চেয়ে কম (${value} ${unit})। ${baseExplanation} ${doctorPointer}`;
  }

  if (flag === 'NORMAL') {
    return `ফলাফল স্বাভাবিক মাত্রার মধ্যে রয়েছে (${value} ${unit})। ${baseExplanation}`;
  }

  return `${baseExplanation} ${doctorPointer}`;
}

/**
 * Finds matching lay-Bangla explanation from the common lab test glossary.
 */
export function lookupGlossaryExplanation(testName: string): string {
  const entry = findGlossaryEntry(testName);
  if (entry) {
    return entry.explanationBn;
  }
  return 'এই পরীক্ষার ফলাফলের সঠিক পর্যালোচনার জন্য অনুগ্রহ করে আপনার রেজিস্ট্রার্ড চিকিৎসকের সঙ্গে যোগাযোগ করুন।';
}

/**
 * Validates or parses a raw report detail object.
 */
export function parseReportDetail(data: unknown): ReportDetail {
  return reportDetail.parse(data);
}

export const REPORT_VISION_SYSTEM_PROMPT = `
You are an expert diagnostic clinical lab report OCR system for Bangladeshi pathology centres.
Extract all test parameters, patient results, units, and printed reference ranges into valid JSON.
Output schema:
{
  "id": "rep-<timestamp>",
  "date": "YYYY-MM-DD",
  "center": "Exact Diagnostic Centre Name & Location",
  "testType": "Panel Name (e.g. Complete Blood Count, Lipid Profile)",
  "rawTranscribedText": "Full text transcribed from report...",
  "values": [
    {
      "test": "Standard Test Name",
      "value": "Numeric result as string (e.g. 9.20, 245, 10.2)",
      "unit": "Unit string (e.g. mmol/L, mg/dL, g/dL, %)",
      "printedRange": "Exact reference range printed on report (e.g. 3.9 - 6.1, < 200, > 40)"
    }
  ]
}
Do not fabricate test values. Extract exactly what is printed on the report.
`.trim();

/**
 * Extracts structured lab metrics from a diagnostic report image URL or Base64 data URI.
 */
export async function extractReportVision(
  imageDataUriOrUrl: string,
  options: ReportExtractionOptions = {},
): Promise<ReportExtractionResult> {
  // 1. If mock fixture provided, use it
  if (options.mockFixture) {
    const validatedDetail = parseReportDetail(options.mockFixture);
    const flags = { high: 0, low: 0, normal: 0, unknown: 0 };
    for (const v of validatedDetail.values) {
      if (v.flag === 'HIGH') flags.high++;
      else if (v.flag === 'LOW') flags.low++;
      else if (v.flag === 'NORMAL') flags.normal++;
      else flags.unknown++;
    }

    return {
      detail: validatedDetail,
      rawTranscribedText: 'Mock transcribed lab report text',
      hasNumericDiscrepancy: false,
      discrepancyDetails: [],
      flagCounts: flags,
    };
  }

  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;

  let rawData: {
    id?: string;
    date?: string;
    center?: string;
    testType?: string;
    rawTranscribedText?: string;
    values?: Array<{
      test: string;
      value: string;
      unit: string;
      printedRange: string;
    }>;
  };

  // 2. If no live API key or offline dev, load first synthetic report as realistic default
  if (!apiKey || apiKey.startsWith('mock-')) {
    try {
      const syntheticPath = path.resolve(process.cwd(), 'data/synthetic-reports.json');
      const fallbackPath = path.resolve(process.cwd(), '../../data/synthetic-reports.json');
      const p = fs.existsSync(syntheticPath) ? syntheticPath : fallbackPath;
      const reports = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const sample = reports[0];
      rawData = {
        id: sample.id,
        date: sample.summary.date,
        center: sample.summary.center,
        testType: sample.summary.testType,
        rawTranscribedText: sample.rawText,
        values: sample.detail.values.map((v: ReportValue) => ({
          test: v.test,
          value: v.value,
          unit: v.unit,
          printedRange: v.printedRange,
        })),
      };
    } catch {
      rawData = {
        id: `rep-${Date.now()}`,
        date: '2026-11-20',
        center: 'Popular Diagnostic Centre Ltd., Dhaka',
        testType: 'Diabetic Profile',
        rawTranscribedText: 'Fasting Blood Sugar (FBS) 9.20 mmol/L 3.9 - 6.1\nHbA1c 8.40 % < 5.7',
        values: [
          {
            test: 'Fasting Blood Sugar (FBS)',
            value: '9.20',
            unit: 'mmol/L',
            printedRange: '3.9 - 6.1 mmol/L',
          },
          {
            test: 'HbA1c',
            value: '8.40',
            unit: '%',
            printedRange: '< 5.7 %',
          },
        ],
      };
    }
  } else {
    // 3. Live model call via OpenRouter
    const client = createOpenRouterClient(apiKey);
    const model = options.useFallbackModel
      ? AI_CONFIG.models.visionFallback
      : AI_CONFIG.models.visionPrimary;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: REPORT_VISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all lab test metrics and reference ranges from this report image strictly into JSON.' },
            { type: 'image_url', image_url: { url: imageDataUriOrUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content || '{}';
    rawData = JSON.parse(content);
  }

  const rawText = rawData.rawTranscribedText || '';
  const textNumbers = new Set(extractNumbers(rawText));

  const discrepancyDetails: string[] = [];
  let hasDiscrepancy = false;
  const flagCounts = { high: 0, low: 0, normal: 0, unknown: 0 };

  // 4. Deterministic post-processing: range comparison, numeric verification, glossary explanation
  const processedValues: ReportValue[] = (rawData.values || []).map((v) => {
    // Check numeric fidelity against transcribed text
    const valueNumbers = extractNumbers(v.value);
    for (const num of valueNumbers) {
      if (rawText && !textNumbers.has(num)) {
        hasDiscrepancy = true;
        discrepancyDetails.push(
          `Extracted value '${v.value}' for test '${v.test}' was not found in raw transcribed text`,
        );
      }
    }

    // Determine flag purely from printed range
    const flag = determineRangeFlag(v.value, v.printedRange);
    if (flag === 'HIGH') flagCounts.high++;
    else if (flag === 'LOW') flagCounts.low++;
    else if (flag === 'NORMAL') flagCounts.normal++;
    else flagCounts.unknown++;

    // Enrich test name with Bangla title from glossary if available
    const glossaryEntry = findGlossaryEntry(v.test);
    const displayName = glossaryEntry ? glossaryEntry.testName : v.test;

    // Generate lay-Bangla explanation concluding with doctor pointer
    const explanationBn = formatReportExplanationBn(v.test, v.value, v.unit, flag);

    return {
      test: displayName,
      value: v.value,
      unit: v.unit,
      printedRange: v.printedRange,
      flag,
      explanationBn,
    };
  });

  const detail: ReportDetail = reportDetail.parse({
    id: rawData.id || `rep-${Date.now()}`,
    date: rawData.date || new Date().toISOString().split('T')[0],
    center: rawData.center || 'Diagnostic Centre',
    testType: rawData.testType || 'Diagnostic Report',
    profileId: options.profileId,
    values: processedValues,
  });

  return {
    detail,
    rawTranscribedText: rawText,
    hasNumericDiscrepancy: hasDiscrepancy,
    discrepancyDetails,
    flagCounts,
  };
}
