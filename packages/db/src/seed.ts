/**
 * Database Seed Helpers for Medical Catalog & Drug Tables
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  DrugGenericRow,
  DrugBrandRow,
  DrugInfoRow,
  GlossaryRow,
  HealthTipRow,
} from './schema/drugs.js';

function readJsonFile<T>(relativePath: string): T[] {
  const candidatePaths = [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), '../../', relativePath),
  ];
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }
  return [];
}

export interface MedicalSeedData {
  generics: DrugGenericRow[];
  brands: DrugBrandRow[];
  drugInfo: DrugInfoRow[];
  glossary: GlossaryRow[];
  tips: HealthTipRow[];
}

/**
 * Loads and structures all seed files into typed database rows.
 */
export function getMedicalSeedData(): MedicalSeedData {
  interface RawDrug {
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

  interface RawDrugInfo {
    generic: string;
    genericBn: string;
    therapeuticClass: string;
    purposeBn: string;
    instructionsBn: string;
    precautionsBn: string;
    sideEffectsBn: string;
    dietaryAdviceBn: string;
  }

  interface RawGlossary {
    id: string;
    testNameEn: string;
    testNameBn: string;
    category: string;
    layExplanationBn: string;
    referenceRangeHint?: string;
    doctorPointerBn: string;
  }

  interface RawTip {
    id: string;
    category: string;
    titleBn: string;
    titleEn: string;
    contentBn: string;
    contentEn: string;
    icon: string;
    tags: string[];
  }

  const rawDrugs = readJsonFile<RawDrug>('data/dgda-drugs.json');
  const rawInfo = readJsonFile<RawDrugInfo>('data/drug-info.json');
  const rawGlossary = readJsonFile<RawGlossary>('data/glossary.json');
  const rawTips = readJsonFile<RawTip>('data/health-tips.json');

  const now = new Date().toISOString();

  // Extract unique generics
  const genericMap = new Map<string, DrugGenericRow>();
  for (const d of rawDrugs) {
    const genericId = `gen-${d.generic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (!genericMap.has(genericId)) {
      genericMap.set(genericId, {
        id: genericId,
        nameEn: d.generic,
        nameBn: d.genericBn || d.generic,
        therapeuticClass: d.therapeuticClass,
        descriptionBn: null,
        warningBn: null,
        createdAt: now,
      });
    }
  }

  // Brands
  const brands: DrugBrandRow[] = rawDrugs.map((d) => {
    const genericId = `gen-${d.generic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return {
      id: d.id,
      genericId,
      nameEn: d.nameEn,
      nameBn: d.nameBn,
      strength: d.strength,
      form: d.form,
      manufacturer: d.manufacturer,
      indicativePrice: d.indicativePrice,
      bnAliases: d.bnAliases || [],
      verified: d.verified ?? true,
      source: d.source || 'DGDA Bangladesh',
      createdAt: now,
    };
  });

  // Drug Info
  const drugInfo: DrugInfoRow[] = rawInfo.map((info) => {
    const genericId = `gen-${info.generic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return {
      id: `info-${info.generic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      genericId,
      purposeBn: info.purposeBn,
      instructionsBn: info.instructionsBn,
      precautionsBn: info.precautionsBn,
      sideEffectsBn: info.sideEffectsBn,
      dietaryAdviceBn: info.dietaryAdviceBn,
      createdAt: now,
    };
  });

  // Glossary
  const glossary: GlossaryRow[] = rawGlossary.map((g) => ({
    id: g.id,
    testNameEn: g.testNameEn,
    testNameBn: g.testNameBn,
    category: g.category,
    layExplanationBn: g.layExplanationBn,
    referenceRangeHint: g.referenceRangeHint || null,
    doctorPointerBn: g.doctorPointerBn,
    createdAt: now,
  }));

  // Tips
  const tips: HealthTipRow[] = rawTips.map((t) => ({
    id: t.id,
    category: t.category,
    titleBn: t.titleBn,
    titleEn: t.titleEn,
    contentBn: t.contentBn,
    contentEn: t.contentEn,
    icon: t.icon,
    tags: t.tags || [],
    createdAt: now,
  }));

  return {
    generics: Array.from(genericMap.values()),
    brands,
    drugInfo,
    glossary,
    tips,
  };
}
