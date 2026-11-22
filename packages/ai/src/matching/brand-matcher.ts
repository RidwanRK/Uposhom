/**
 * Bilingual Brand Matching & Trigram Search Engine
 *
 * Implements prescription brand verification and typed-entry autocomplete
 * according to Master Plan section 5 (Intake & Drug-Name Search):
 * - Latin input: fuzzy-matched with pg_trgm similarity algorithm on name_en
 * - Bangla input: matched against name_bn and bn_aliases with phonetic normalization
 * - High confidence threshold (>= 0.75) for auto-match, flagging lower scores for visual confirmation
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DgdaDrugRecord } from '../agents/generic-agent.js';

export type MatchReason =
  | 'EXACT_LATIN'
  | 'EXACT_BANGLA'
  | 'ALIAS_MATCH'
  | 'PREFIX_MATCH'
  | 'TRIGRAM_FUZZY'
  | 'NO_MATCH';

export interface BrandMatchCandidate {
  drug: DgdaDrugRecord;
  score: number; // 0.0 to 1.0
  matchReason: MatchReason;
  matchedOnText: string;
}

export interface BrandMatchResult {
  matched: boolean;
  bestMatch?: BrandMatchCandidate;
  candidates: BrandMatchCandidate[];
  isHighConfidence: boolean; // score >= 0.75
}

let cachedCatalog: DgdaDrugRecord[] | null = null;

export function loadDgdaCatalog(): DgdaDrugRecord[] {
  if (cachedCatalog) return cachedCatalog;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/dgda-drugs.json'),
      path.resolve(process.cwd(), '../../data/dgda-drugs.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedCatalog = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedCatalog!;
      }
    }
  } catch {
    // fallback
  }
  return [];
}

/**
 * Generates trigrams identical to PostgreSQL pg_trgm extension.
 * Pads string with two leading spaces and one trailing space, then extracts 3-char slices.
 */
export function generateTrigrams(text: string): Set<string> {
  const normalized = `  ${text.toLowerCase().trim()} `;
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.substring(i, i + 3));
  }
  return trigrams;
}

/**
 * Computes pg_trgm Jaccard similarity: |A ∩ B| / |A ∪ B|
 */
export function computeTrigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const triA = generateTrigrams(a);
  const triB = generateTrigrams(b);

  let intersectionSize = 0;
  for (const tri of triA) {
    if (triB.has(tri)) {
      intersectionSize++;
    }
  }

  const unionSize = triA.size + triB.size - intersectionSize;
  if (unionSize === 0) return 0;

  return Number((intersectionSize / unionSize).toFixed(4));
}

/**
 * Normalizes Bangla characters for robust comparison across phonetic variations:
 * - য় and য়
 * - ণ and ন
 * - শ, ষ, and স
 * - ী and ি, ূ and ু
 */
export function normalizeBanglaText(text: string): string {
  return text
    .trim()
    .replace(/\u09DF/g, '\u09AF\u09BC') // Normalize য় / য়
    .replace(/ণ/g, 'ন')
    .replace(/[ষশ]/g, 'স')
    .replace(/ী/g, 'ি')
    .replace(/ূ/g, 'ু')
    .toLowerCase();
}

/**
 * Detects if a string is predominantly Bangla script.
 */
export function isBanglaScript(text: string): boolean {
  return /[\u0980-\u09FF]/.test(text);
}

/**
 * Matches a query against the DGDA catalog using bilingual logic.
 */
export function matchBrand(query: string, catalog?: DgdaDrugRecord[]): BrandMatchResult {
  const drugs = catalog || loadDgdaCatalog();
  const rawTrimmed = query.trim();
  if (!rawTrimmed) {
    return { matched: false, candidates: [], isHighConfidence: false };
  }

  const isBangla = isBanglaScript(rawTrimmed);
  const candidates: BrandMatchCandidate[] = [];

  if (isBangla) {
    const normalizedQuery = normalizeBanglaText(rawTrimmed);

    for (const drug of drugs) {
      const normalizedNameBn = normalizeBanglaText(drug.nameBn);

      // Exact Bangla name match
      if (normalizedNameBn === normalizedQuery || drug.nameBn === rawTrimmed) {
        candidates.push({
          drug,
          score: 1.0,
          matchReason: 'EXACT_BANGLA',
          matchedOnText: drug.nameBn,
        });
        continue;
      }

      // Check Bangla aliases
      let aliasMatched = false;
      if (drug.bnAliases && drug.bnAliases.length > 0) {
        for (const alias of drug.bnAliases) {
          const normAlias = normalizeBanglaText(alias);
          if (normAlias === normalizedQuery || alias === rawTrimmed) {
            candidates.push({
              drug,
              score: 0.95,
              matchReason: 'ALIAS_MATCH',
              matchedOnText: alias,
            });
            aliasMatched = true;
            break;
          }
        }
      }
      if (aliasMatched) continue;

      // Substring / Prefix match in Bangla
      if (normalizedNameBn.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedNameBn)) {
        const ratio = Math.min(normalizedQuery.length, normalizedNameBn.length) / Math.max(normalizedQuery.length, normalizedNameBn.length);
        candidates.push({
          drug,
          score: Number((0.85 * ratio).toFixed(2)),
          matchReason: 'PREFIX_MATCH',
          matchedOnText: drug.nameBn,
        });
      }
    }
  } else {
    // Latin / English search
    const lowerQuery = rawTrimmed.toLowerCase();

    for (const drug of drugs) {
      const lowerName = drug.nameEn.toLowerCase();

      // Exact Latin match
      if (lowerName === lowerQuery) {
        candidates.push({
          drug,
          score: 1.0,
          matchReason: 'EXACT_LATIN',
          matchedOnText: drug.nameEn,
        });
        continue;
      }

      // Prefix match
      if (lowerName.startsWith(lowerQuery) || lowerQuery.startsWith(lowerName)) {
        const ratio = Math.min(lowerQuery.length, lowerName.length) / Math.max(lowerQuery.length, lowerName.length);
        candidates.push({
          drug,
          score: Number((0.88 * ratio).toFixed(2)),
          matchReason: 'PREFIX_MATCH',
          matchedOnText: drug.nameEn,
        });
        continue;
      }

      // Trigram fuzzy similarity (pg_trgm equivalent)
      const sim = computeTrigramSimilarity(lowerQuery, lowerName);
      if (sim >= 0.35) {
        candidates.push({
          drug,
          score: sim,
          matchReason: 'TRIGRAM_FUZZY',
          matchedOnText: drug.nameEn,
        });
      }
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  const bestMatch = candidates[0];
  const matched = Boolean(bestMatch && bestMatch.score >= 0.35);
  const isHighConfidence = Boolean(bestMatch && bestMatch.score >= 0.75);

  return {
    matched,
    bestMatch,
    candidates: candidates.slice(0, 5),
    isHighConfidence,
  };
}

/**
 * Autocomplete brand name search for mobile typed-entry fallback.
 */
export function autocompleteBrandNames(
  query: string,
  limit = 5,
  catalog?: DgdaDrugRecord[],
): BrandMatchCandidate[] {
  const result = matchBrand(query, catalog);
  return result.candidates.slice(0, limit);
}
