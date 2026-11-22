/**
 * Diagnostic Report Vault Vision Extractor
 *
 * Extracts test metrics, units, and printed reference ranges directly from report images.
 * Determines flag (HIGH, LOW, NORMAL) by evaluating the numerical value against the printed range,
 * and attaches lay-Bangla explanations concluding with a doctor consultation recommendation.
 */

import { reportDetail, type ReportDetail } from '@uposhom/shared';
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

let cachedGlossary: ReportGlossaryEntry[] | null = null;

function loadGlossary(): ReportGlossaryEntry[] {
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
 * Compares an extracted numeric value against a printed range string.
 * Example printed ranges: "3.9 - 6.1", "< 200", "> 40", "13.0 - 17.0"
 */
export function determineRangeFlag(valueStr: string, printedRangeStr: string): 'HIGH' | 'LOW' | 'NORMAL' | 'UNKNOWN' {
  const val = parseFloat(valueStr.replace(/,/g, ''));
  if (isNaN(val)) return 'UNKNOWN';

  // Handle "< X" (e.g. "< 200", "< 5.7")
  const lessMatch = printedRangeStr.match(/<\s*([0-9.]+)/);
  if (lessMatch && lessMatch[1]) {
    const limit = parseFloat(lessMatch[1]);
    return val > limit ? 'HIGH' : 'NORMAL';
  }

  // Handle "> X" (e.g. "> 40", "> 90")
  const greaterMatch = printedRangeStr.match(/>\s*([0-9.]+)/);
  if (greaterMatch && greaterMatch[1]) {
    const limit = parseFloat(greaterMatch[1]);
    return val < limit ? 'LOW' : 'NORMAL';
  }

  // Handle "X - Y" (e.g. "3.9 - 6.1", "12.0 - 16.0")
  const rangeMatch = printedRangeStr.match(/([0-9.]+)\s*-\s*([0-9.]+)/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (val < min) return 'LOW';
    if (val > max) return 'HIGH';
    return 'NORMAL';
  }

  return 'NORMAL';
}

/**
 * Finds matching lay-Bangla explanation from the common lab test glossary.
 */
export function lookupGlossaryExplanation(testName: string): string {
  const glossary = loadGlossary();
  const lower = testName.toLowerCase();

  const found = glossary.find((g) => {
    return (
      lower.includes(g.id.toLowerCase()) ||
      lower.includes(g.testName.toLowerCase()) ||
      g.testName.toLowerCase().includes(lower)
    );
  });

  if (found) {
    return found.explanationBn;
  }

  return 'এই পরীক্ষার ফলাফলের সঠিক পর্যালোচনার জন্য অনুগ্রহ করে আপনার রেজিস্ট্রার্ড চিকিৎসকের সঙ্গে যোগাযোগ করুন।';
}

/**
 * Validates or parses a raw report detail object.
 */
export function parseReportDetail(data: unknown): ReportDetail {
  return reportDetail.parse(data);
}
