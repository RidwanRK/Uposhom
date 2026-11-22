/**
 * Medical Catalog & Drug Tables Schema Definitions
 *
 * Owned by Workstream C (Master Plan section 18, line 1278):
 * - drug_generics
 * - drug_brands
 * - drug_info
 * - glossary
 * - tips
 */

export interface DrugGenericRow {
  id: string;
  nameEn: string;
  nameBn: string;
  therapeuticClass: string;
  descriptionBn: string | null;
  warningBn: string | null;
  createdAt: string;
}

export interface DrugBrandRow {
  id: string;
  genericId: string;
  nameEn: string;
  nameBn: string;
  strength: string;
  form: string;
  manufacturer: string;
  indicativePrice: number;
  bnAliases: string[];
  verified: boolean;
  source: string;
  createdAt: string;
}

export interface DrugInfoRow {
  id: string;
  genericId: string;
  purposeBn: string;
  instructionsBn: string;
  precautionsBn: string;
  sideEffectsBn: string;
  dietaryAdviceBn: string;
  createdAt: string;
}

export interface GlossaryRow {
  id: string;
  testNameEn: string;
  testNameBn: string;
  category: string;
  layExplanationBn: string;
  referenceRangeHint: string | null;
  doctorPointerBn: string;
  createdAt: string;
}

export interface HealthTipRow {
  id: string;
  category: string;
  titleBn: string;
  titleEn: string;
  contentBn: string;
  contentEn: string;
  icon: string;
  tags: string[];
  createdAt: string;
}

export const DRUG_TABLE_NAMES = {
  drugGenerics: 'drug_generics',
  drugBrands: 'drug_brands',
  drugInfo: 'drug_info',
  glossary: 'glossary',
  tips: 'tips',
} as const;
