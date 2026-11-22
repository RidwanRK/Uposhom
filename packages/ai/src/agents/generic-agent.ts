/**
 * Generic Medicine Alternative Finder Agent
 *
 * Equipped with tool `searchAlternatives(brandName)` querying the local DGDA-sourced
 * drug table for same active ingredient, strength, and form.
 *
 * Safe Substitution Policy:
 * - Alternatives are same-ingredient equivalents with indicative prices.
 * - Always includes the reminder that a registered doctor or pharmacist confirms any substitution.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { createOpenRouterAgentModel } from '../client.js';
import type { GenericsResponse, DrugBrand } from '@uposhom/shared';
import { matchBrand } from '../matching/brand-matcher.js';
import fs from 'node:fs';
import path from 'node:path';

export interface DgdaDrugRecord {
  id: string;
  nameEn: string;
  nameBn: string;
  generic: string;
  genericBn?: string;
  therapeuticClass: string;
  strength: string;
  form: string;
  manufacturer: string;
  indicativePrice: number;
  bnAliases: string[];
  verified?: boolean;
  source?: string;
}

let cachedDrugs: DgdaDrugRecord[] | null = null;

function loadDgdaDrugs(): DgdaDrugRecord[] {
  if (cachedDrugs) return cachedDrugs;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/dgda-drugs.json'),
      path.resolve(process.cwd(), '../../data/dgda-drugs.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedDrugs = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedDrugs!;
      }
    }
  } catch {
    // Fall back to empty array
  }
  return [];
}

/**
 * Searches the DGDA catalog for alternatives with matching active ingredient, strength, and form.
 */
export function findGenericAlternatives(brandQuery: string): GenericsResponse | null {
  const drugs = loadDgdaDrugs();
  const q = brandQuery.toLowerCase().trim();

  // Try bilingual trigram & phonetic matcher first
  const matchResult = matchBrand(q, drugs);
  let original: DgdaDrugRecord | undefined = matchResult.bestMatch?.drug;

  // If no direct match, try stripping query noise words (e.g. "বিকল্প", "medicine", etc.)
  if (!original) {
    const cleaned = q
      .replace(/(বিকল্প|কি|কী|এর|medicine|tablet|tablets|alternative|please|bikalpo|koto|dam)/gi, '')
      .trim();
    if (cleaned && cleaned !== q) {
      const cleanMatch = matchBrand(cleaned, drugs);
      original = cleanMatch.bestMatch?.drug;
    }
  }

  // Fallback to substring / alias match
  if (!original) {
    original = drugs.find((d) => {
      return (
        d.nameEn.toLowerCase() === q ||
        d.nameEn.toLowerCase().startsWith(q) ||
        d.nameBn.includes(q) ||
        d.bnAliases.some((alias) => alias.toLowerCase().includes(q))
      );
    });
  }

  if (!original) return null;

  // Find alternatives sharing generic, strength, and form (excluding the searched brand itself)
  const altDrugs = drugs.filter(
    (d) =>
      d.id !== original.id &&
      d.generic.toLowerCase() === original.generic.toLowerCase() &&
      d.strength.toLowerCase() === original.strength.toLowerCase() &&
      d.form.toLowerCase() === original.form.toLowerCase(),
  );

  // Sort by price ascending
  altDrugs.sort((a, b) => a.indicativePrice - b.indicativePrice);

  const mappedOriginal: DrugBrand = {
    id: original.id,
    nameEn: original.nameEn,
    nameBn: original.nameBn,
    generic: original.generic,
    strength: original.strength,
    form: original.form,
    manufacturer: original.manufacturer,
    indicativePrice: original.indicativePrice,
  };

  const alternatives = altDrugs.map((alt) => {
    let savingPercent: number | null = null;
    if (original.indicativePrice > 0 && alt.indicativePrice < original.indicativePrice) {
      savingPercent = Math.round(
        ((original.indicativePrice - alt.indicativePrice) / original.indicativePrice) * 100,
      );
    }
    return {
      id: alt.id,
      nameEn: alt.nameEn,
      nameBn: alt.nameBn,
      generic: alt.generic,
      strength: alt.strength,
      form: alt.form,
      manufacturer: alt.manufacturer,
      indicativePrice: alt.indicativePrice,
      savingPercent,
    };
  });

  return {
    original: mappedOriginal,
    alternatives,
    note: 'ঔষধ পরিবর্তনের পূর্বে অবশ্যই আপনার রেজিস্টার্ড চিকিৎসক বা ফার্মাসিস্টের পরামর্শ গ্রহণ করুন।',
  };
}

export const GENERIC_AGENT_INSTRUCTIONS = `
আপনি উপশম (Uposhom) এর জেনেরিক ড্রাগ অল্টারনেটিভ বিশেষজ্ঞ (GenericFinderAgent)।
আপনার দায়িত্ব হলো ব্যবহারকারী কোনো ব্র্যান্ডের ওষুধের নাম জানতে চাইলে DGDA অনুমোদিত একই উপাদান (active ingredient), একই শক্তি (strength) ও একই রূপের (form) সাশ্রয়ী বিকল্প খুঁজে দেওয়া।
সর্বদা স্পষ্ট করে জানিয়ে দিন যে এগুলো একই উপাদানের বিকল্প এবং ওষুধ পরিবর্তনের আগে রেজিস্টার্ড চিকিৎসক বা ফার্মাসিস্টের নিশ্চিতকরণ আবশ্যক।
`.trim();

/**
 * Creates the GenericFinderAgent.
 */
export function createGenericAgent(): Agent {
  const searchAlternativesTool = tool({
    name: 'searchAlternatives',
    description: 'একই জেনেরিক উপাদানের বিকল্প ওষুধের তালিকা খুঁজুন (Search same-ingredient alternatives)',
    parameters: z.object({
      brandName: z.string().describe('ওষুধের ব্র্যান্ড নাম (বাংলা বা ইংরেজি, যেমন Napa, সেকলো)'),
    }),
    execute: async ({ brandName }) => {
      const result = findGenericAlternatives(brandName);
      if (!result) {
        return JSON.stringify({
          found: false,
          message: `দুঃখিত, '${brandName}' নামের কোনো ঔষধ ক্যাটালগে খুঁজে পাওয়া যায়নি।`,
        });
      }
      return JSON.stringify({ found: true, result });
    },
  });

  return new Agent({
    name: 'GenericFinderAgent',
    instructions: GENERIC_AGENT_INSTRUCTIONS,
    model: createOpenRouterAgentModel(),
    tools: [searchAlternativesTool],
  });
}
