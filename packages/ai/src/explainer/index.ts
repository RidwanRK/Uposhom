/**
 * Prescription Explainer with Strict Deterministic Numeric Guard & Curated Drug Info
 *
 * Generates simple, respectful lay-Bangla explanations for confirmed prescriptions
 * joined with curated clinical advice from data/drug-info.json.
 *
 * Safety Invariants:
 * 1. AI explanations must NEVER fabricate, alter, or add dosage numbers.
 * 2. Any AI-generated text containing unauthorized numbers is immediately rejected
 *    by `validateAiNumericOutput` and replaced with the safe deterministic template.
 * 3. Does NOT give unverified medical diagnoses or suggest changing doctor's doses.
 */

import { type ConfirmItem } from '@uposhom/shared';
import { validateAiNumericOutput, type NumericGuardResult } from '../guards/numeric-guard.js';
import { matchBrand } from '../matching/brand-matcher.js';
import { createOpenRouterClient } from '../client.js';
import { AI_CONFIG } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';

export interface DrugInfoRecord {
  generic: string;
  genericBn: string;
  therapeuticClass: string;
  purposeBn: string;
  instructionsBn: string;
  precautionsBn: string;
  sideEffectsBn: string;
  dietaryAdviceBn: string;
}

export interface ExplainerItemCard {
  brandName: string;
  dosageStrength: string;
  genericName?: string;
  purposeBn?: string;
  patternBn: string;
  mealBn: string;
  durationDays: number;
  precautionsBn?: string;
  dietaryAdviceBn?: string;
  isCritical: boolean;
}

export interface ExplainerOptions {
  apiKey?: string;
  useModel?: boolean;
  customExplanation?: string;
  includeDrugDetails?: boolean;
}

export interface PrescriptionExplanationResult {
  explanationBn: string;
  guarded: boolean;
  usedFallback: boolean;
  rejectedNumbers?: string[];
  cards: ExplainerItemCard[];
  guardReport: NumericGuardResult;
}

let cachedDrugInfo: DrugInfoRecord[] | null = null;

export function loadDrugInfoCatalog(): DrugInfoRecord[] {
  if (cachedDrugInfo) return cachedDrugInfo;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/drug-info.json'),
      path.resolve(process.cwd(), '../../data/drug-info.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedDrugInfo = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedDrugInfo!;
      }
    }
  } catch {
    // fallback
  }
  return [];
}

/**
 * Retrieves curated clinical drug information for a brand name.
 */
export function getDrugInfoForBrand(brandName: string): DrugInfoRecord | null {
  const brandMatch = matchBrand(brandName);
  if (!brandMatch.bestMatch) return null;

  const genericName = brandMatch.bestMatch.drug.generic.toLowerCase();
  const drugInfoList = loadDrugInfoCatalog();

  for (const info of drugInfoList) {
    if (info.generic.toLowerCase() === genericName) {
      return info;
    }
  }

  // Prefix match
  for (const info of drugInfoList) {
    if (
      info.generic.toLowerCase().startsWith(genericName) ||
      genericName.startsWith(info.generic.toLowerCase())
    ) {
      return info;
    }
  }

  return null;
}

/**
 * Translates dosage patterns to friendly lay-Bangla phrasing.
 */
export function formatPatternInBangla(pattern: string): string {
  const p = pattern.trim();
  switch (p) {
    case '1+0+1':
      return 'সকালে ১টি ও রাতে ১টি';
    case '1+1+1':
      return 'সকালে ১টি, দুপুরে ১টি ও রাতে ১টি';
    case '0+0+1':
      return 'রাতে ১টি';
    case '1+0+0':
      return 'সকালে ১টি';
    case '0+1+0':
      return 'দুপরে ১টি';
    case '½+0+½':
    case '1/2+0+1/2':
      return 'সকালে অর্ধেক (০.৫) ও রাতে অর্ধেক (০.৫)';
    case 'OD':
      return 'দিনে একবার';
    case 'BD':
    case 'BID':
      return 'দিনে দুইবার';
    case 'TDS':
    case 'TID':
      return 'দিনে তিনবার';
    default:
      return `${p} নিয়ম অনুযায়ী`;
  }
}

/**
 * Translates meal relations to friendly lay-Bangla phrasing.
 */
export function formatMealRelationInBangla(relation: string): string {
  switch (relation) {
    case 'AC':
      return 'খাবার ৩০ মিনিট আগে (খালি পেটে)';
    case 'PC':
      return 'খাবার পর (ভরা পেটে)';
    case 'WITH_MEAL':
      return 'খাবারের সাথে';
    default:
      return 'চিকিৎসকের নির্দেশিত নিয়মে';
  }
}

/**
 * Builds structured explanation cards joined with curated drug_info.
 */
export function buildExplainerItemCards(items: ConfirmItem[]): ExplainerItemCard[] {
  return items.map((item) => {
    const info = getDrugInfoForBrand(item.brandName);
    const patternBn = formatPatternInBangla(item.parsedPattern);
    const mealBn = formatMealRelationInBangla(item.mealRelation);

    return {
      brandName: item.brandName,
      dosageStrength: item.dosageStrength,
      genericName: info?.generic,
      purposeBn: info?.purposeBn,
      patternBn,
      mealBn,
      durationDays: item.durationDays,
      precautionsBn: info?.precautionsBn,
      dietaryAdviceBn: info?.dietaryAdviceBn,
      isCritical: item.isCritical,
    };
  });
}

/**
 * Generates a 100% deterministic, zero-hallucination lay-Bangla explanation.
 */
export function generateDeterministicExplanation(
  items: ConfirmItem[],
  cards?: ExplainerItemCard[],
): string {
  if (items.length === 0) {
    return 'প্রেসক্রিপশনে কোনো ওষুধ তালিকাভুক্ত নেই।';
  }

  const itemCards = cards || buildExplainerItemCards(items);
  const lines: string[] = [
    'আপনার প্রেসক্রিপশনের অনুমোদিত ওষুধসমূহের সেবনবিধি নিচে দেওয়া হলো:\n',
  ];

  itemCards.forEach((card, index) => {
    const criticalTag = card.isCritical ? ' [জরুরি ওষুধ]' : '';
    lines.push(
      `${index + 1}. ${card.brandName} (${card.dosageStrength})${criticalTag}:\n` +
        (card.purposeBn ? `   • কাজের ধরন: ${card.purposeBn}\n` : '') +
        `   • মাত্রা ও সময়: ${card.patternBn}\n` +
        `   • নিয়ম: ${card.mealBn}\n` +
        `   • মেয়াদকাল: ${card.durationDays} দিন` +
        (card.precautionsBn ? `\n   • সতর্কতা: ${card.precautionsBn}` : ''),
    );
  });

  lines.push(
    '\nসাধারণ পরামর্শ:\n' +
      '• প্রতিটি ওষুধ পর্যাপ্ত পরিষ্কার পানির সাথে গ্রহণ করুন।\n' +
      '• কোনো ডোজ বাদ পড়লে মনে পড়ার সাথে সাথে গ্রহণ করুন (তবে পরবর্তী ডোজের সময় কাছাকাছি হলে ডাবল ডোজ খাবেন না)।\n' +
      '• যেকোনো শারীরিক অস্বস্তি বা পরিবর্তনের ক্ষেত্রে অবিলম্বে আপনার চিকিৎসকের পরামর্শ নিন।',
  );

  return lines.join('\n');
}

/**
 * Generates prescription explanation and verifies numeric fidelity.
 */
export async function generatePrescriptionExplanation(
  items: ConfirmItem[],
  options: ExplainerOptions = {},
): Promise<PrescriptionExplanationResult> {
  const cards = buildExplainerItemCards(items);
  const deterministicText = generateDeterministicExplanation(items, cards);

  // If testing custom text or LLM simulation
  if (options.customExplanation) {
    const guardReport = validateAiNumericOutput(options.customExplanation, items);
    if (!guardReport.valid) {
      return {
        explanationBn: guardReport.fallbackMessageBn || deterministicText,
        guarded: true,
        usedFallback: true,
        rejectedNumbers: guardReport.rejectedNumbers,
        cards,
        guardReport,
      };
    }
    return {
      explanationBn: options.customExplanation,
      guarded: true,
      usedFallback: false,
      cards,
      guardReport,
    };
  }

  // If model call requested and API key provided
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
  if (options.useModel && apiKey && !apiKey.startsWith('mock-')) {
    try {
      const client = createOpenRouterClient(apiKey);
      const prompt = `
Explain this confirmed prescription in polite, lay-Bangla for an elderly patient and caregiver.
Use the following confirmed items and curated drug details:
${JSON.stringify(cards, null, 2)}

Rules:
- DO NOT invent, hallucinate, change, or add any dosage numbers, days, or strengths.
- ONLY reference numbers that exist in this exact input list.
- Keep tone empathetic, clear, respectful, and reassuring.
- Do not provide unconfirmed medical diagnoses or suggest changing doses.
`.trim();

      const response = await client.chat.completions.create({
        model: AI_CONFIG.models.agentsPrimary,
        messages: [{ role: 'user', content: prompt }],
      });

      const aiText = response.choices[0]?.message?.content || '';
      const guardReport = validateAiNumericOutput(aiText, items);

      if (!guardReport.valid) {
        return {
          explanationBn: guardReport.fallbackMessageBn || deterministicText,
          guarded: true,
          usedFallback: true,
          rejectedNumbers: guardReport.rejectedNumbers,
          cards,
          guardReport,
        };
      }

      return {
        explanationBn: aiText,
        guarded: true,
        usedFallback: false,
        cards,
        guardReport,
      };
    } catch {
      // Fallback on model error
    }
  }

  // Default safe deterministic output
  const guardReport = validateAiNumericOutput(deterministicText, items);
  return {
    explanationBn: deterministicText,
    guarded: true,
    usedFallback: false,
    cards,
    guardReport,
  };
}
