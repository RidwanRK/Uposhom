/**
 * SQL Migrations for Medical Catalog Tables (Workstream C)
 */

export interface DbMigration {
  id: string;
  sql: string;
}

export const DRUG_MIGRATIONS: readonly DbMigration[] = [
  {
    id: '0002_drug_tables',
    sql: `
CREATE TABLE IF NOT EXISTS drug_generics (
  id text PRIMARY KEY,
  name_en text NOT NULL,
  name_bn text NOT NULL,
  therapeutic_class text NOT NULL,
  description_bn text,
  warning_bn text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drug_generics_class ON drug_generics (therapeutic_class);
CREATE INDEX IF NOT EXISTS idx_drug_generics_name_en ON drug_generics (name_en);

CREATE TABLE IF NOT EXISTS drug_brands (
  id text PRIMARY KEY,
  generic_id text NOT NULL REFERENCES drug_generics(id) ON DELETE CASCADE,
  name_en text NOT NULL,
  name_bn text NOT NULL,
  strength text NOT NULL,
  form text NOT NULL,
  manufacturer text NOT NULL,
  indicative_price numeric(10, 2) NOT NULL DEFAULT 0.00,
  bn_aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'DGDA Bangladesh',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drug_brands_generic_id ON drug_brands (generic_id);
CREATE INDEX IF NOT EXISTS idx_drug_brands_name_en ON drug_brands (name_en);
CREATE INDEX IF NOT EXISTS idx_drug_brands_name_bn ON drug_brands (name_bn);

CREATE TABLE IF NOT EXISTS drug_info (
  id text PRIMARY KEY,
  generic_id text NOT NULL REFERENCES drug_generics(id) ON DELETE CASCADE,
  purpose_bn text NOT NULL,
  instructions_bn text NOT NULL,
  precautions_bn text NOT NULL,
  side_effects_bn text NOT NULL,
  dietary_advice_bn text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drug_info_generic ON drug_info (generic_id);

CREATE TABLE IF NOT EXISTS glossary (
  id text PRIMARY KEY,
  test_name_en text NOT NULL,
  test_name_bn text NOT NULL,
  category text NOT NULL,
  lay_explanation_bn text NOT NULL,
  reference_range_hint text,
  doctor_pointer_bn text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_glossary_category ON glossary (category);

CREATE TABLE IF NOT EXISTS tips (
  id text PRIMARY KEY,
  category text NOT NULL,
  title_bn text NOT NULL,
  title_en text NOT NULL,
  content_bn text NOT NULL,
  content_en text NOT NULL,
  icon text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tips_category ON tips (category);
`,
  },
];
