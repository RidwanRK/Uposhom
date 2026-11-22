import { describe, it, expect } from 'vitest';
import {
  matchBrand,
  autocompleteBrandNames,
  computeTrigramSimilarity,
  normalizeBanglaText,
  isBanglaScript,
} from '../src/matching/brand-matcher.js';

describe('Bilingual Brand Matching & Trigram Search Engine', () => {
  it('detects Bangla script accurately', () => {
    expect(isBanglaScript('নাপা')).toBe(true);
    expect(isBanglaScript('সেকলো ২০')).toBe(true);
    expect(isBanglaScript('Napa')).toBe(false);
    expect(isBanglaScript('1+0+1')).toBe(false);
  });

  it('computes pg_trgm trigram similarity accurately', () => {
    // Exact identical strings have similarity 1.0
    expect(computeTrigramSimilarity('napa', 'napa')).toBe(1.0);

    // Minor typo or substring
    const simHigh = computeTrigramSimilarity('napa', 'napa extend');
    expect(simHigh).toBeGreaterThan(0.35);

    // Completely distinct strings have near 0 similarity
    const simLow = computeTrigramSimilarity('napa', 'ciprofloxacin');
    expect(simLow).toBeLessThan(0.15);
  });

  it('matches Latin brand names with exact and trigram similarity', () => {
    // Exact match
    const exact = matchBrand('Napa');
    expect(exact.matched).toBe(true);
    expect(exact.isHighConfidence).toBe(true);
    expect(exact.bestMatch?.drug.generic).toBe('Paracetamol');
    expect(exact.bestMatch?.matchReason).toBe('EXACT_LATIN');

    // Case-insensitive
    const lower = matchBrand('seclo 20');
    expect(lower.matched).toBe(true);
    expect(lower.bestMatch?.drug.generic).toBe('Omeprazole');

    // Minor typo / OCR variant
    const fuzzy = matchBrand('Napa Extnd');
    expect(fuzzy.matched).toBe(true);
    expect(fuzzy.bestMatch?.drug.nameEn).toBe('Napa Extend');
    expect(fuzzy.bestMatch?.score).toBeGreaterThan(0.5);
  });

  it('matches Bangla brand names and aliases with phonetic normalization', () => {
    // Exact Bangla
    const exactBn = matchBrand('নাপা');
    expect(exactBn.matched).toBe(true);
    expect(exactBn.isHighConfidence).toBe(true);
    expect(exactBn.bestMatch?.matchReason).toBe('EXACT_BANGLA');

    // Alias match
    const aliasBn = matchBrand('নাপা ৫০০');
    expect(aliasBn.matched).toBe(true);
    expect(aliasBn.bestMatch?.matchReason).toBe('ALIAS_MATCH');

    // Phonetic normalization (e.g. য় vs য়)
    const norm1 = normalizeBanglaText('অ্যাজিথ্রোমাইসিন');
    const norm2 = normalizeBanglaText('অ্যাজিথ্রোমাইসীন'); // diacritic difference
    expect(norm1).toBe(norm2);
  });

  it('provides autocomplete suggestions ordered by similarity for typed fallback', () => {
    const suggestions = autocompleteBrandNames('Nap', 3);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(3);
    expect(suggestions[0]!.drug.nameEn.toLowerCase()).toContain('nap');
  });

  it('flags unverified or non-existent brand names as low confidence', () => {
    const unknown = matchBrand('XylophoneNonExistentMedicine999');
    expect(unknown.isHighConfidence).toBe(false);
  });
});
