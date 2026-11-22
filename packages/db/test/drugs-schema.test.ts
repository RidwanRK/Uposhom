import { describe, it, expect } from 'vitest';
import {
  DRUG_TABLE_NAMES,
  DRUG_MIGRATIONS,
  getMedicalSeedData,
} from '../src/index.js';

describe('Database Drug Tables Schema & Medical Seed Catalog', () => {
  it('defines correct table names according to Master Plan specification', () => {
    expect(DRUG_TABLE_NAMES.drugGenerics).toBe('drug_generics');
    expect(DRUG_TABLE_NAMES.drugBrands).toBe('drug_brands');
    expect(DRUG_TABLE_NAMES.drugInfo).toBe('drug_info');
    expect(DRUG_TABLE_NAMES.glossary).toBe('glossary');
    expect(DRUG_TABLE_NAMES.tips).toBe('tips');
  });

  it('includes valid SQL migration for drug tables with indexes', () => {
    expect(DRUG_MIGRATIONS).toHaveLength(1);
    const m = DRUG_MIGRATIONS[0]!;
    expect(m.id).toBe('0002_drug_tables');
    expect(m.sql).toContain('CREATE TABLE IF NOT EXISTS drug_generics');
    expect(m.sql).toContain('CREATE TABLE IF NOT EXISTS drug_brands');
    expect(m.sql).toContain('CREATE TABLE IF NOT EXISTS drug_info');
    expect(m.sql).toContain('CREATE TABLE IF NOT EXISTS glossary');
    expect(m.sql).toContain('CREATE TABLE IF NOT EXISTS tips');
  });

  it('loads and structures seed data across all 5 medical tables', () => {
    const data = getMedicalSeedData();

    // Verified DGDA drug records
    expect(data.generics.length).toBeGreaterThanOrEqual(20);
    expect(data.brands.length).toBeGreaterThanOrEqual(150);

    // Relational integrity: every brand must link to a valid genericId
    const genericIdSet = new Set(data.generics.map((g) => g.id));
    for (const brand of data.brands) {
      expect(genericIdSet.has(brand.genericId)).toBe(true);
      expect(brand.indicativePrice).toBeGreaterThan(0);
    }

    // Curated drug info
    expect(data.drugInfo.length).toBeGreaterThanOrEqual(10);
    for (const info of data.drugInfo) {
      expect(info.purposeBn).toBeDefined();
      expect(info.instructionsBn).toBeDefined();
    }

    // Diagnostic glossary
    expect(data.glossary.length).toBe(40);
    for (const test of data.glossary) {
      expect(test.testNameEn).toBeDefined();
      expect(test.layExplanationBn).toBeDefined();
    }

    // Rotating health tips
    expect(data.tips.length).toBe(10);
    for (const tip of data.tips) {
      expect(tip.titleBn).toBeDefined();
      expect(tip.contentBn).toBeDefined();
    }
  });
});
