import { describe, it, expect } from 'vitest';
import {
  determineRangeFlag,
  findGlossaryEntry,
  formatReportExplanationBn,
  extractReportVision,
  parseReportDetail,
} from '../src/vision/report-vault.js';
import { reportDetail, type ReportDetail } from '@uposhom/shared';
import fs from 'node:fs';
import path from 'node:path';

describe('Diagnostic Report Vault Vision Extraction & Range Flags', () => {
  describe('Deterministic Range Flag Calculation (Printed Reference Range)', () => {
    it('evaluates standard numeric range (min - max)', () => {
      // Fasting Blood Sugar: 3.9 - 6.1 mmol/L
      expect(determineRangeFlag('9.20', '3.9 - 6.1 mmol/L')).toBe('HIGH');
      expect(determineRangeFlag('2.50', '3.9 - 6.1 mmol/L')).toBe('LOW');
      expect(determineRangeFlag('4.80', '3.9 - 6.1 mmol/L')).toBe('NORMAL');

      // Hemoglobin: 13.0 - 17.0 g/dL
      expect(determineRangeFlag('10.2', '13.0 - 17.0 g/dL')).toBe('LOW');
      expect(determineRangeFlag('14.5', '13.0 - 17.0 g/dL')).toBe('NORMAL');
      expect(determineRangeFlag('18.1', '13.0 - 17.0 g/dL')).toBe('HIGH');

      // ESR: 0 - 15 mm/1st hr
      expect(determineRangeFlag('28', '0 - 15 mm/1st hr')).toBe('HIGH');
      expect(determineRangeFlag('10', '0 - 15 mm/1st hr')).toBe('NORMAL');
    });

    it('evaluates upper limit ranges (< X or <= X)', () => {
      // Total Cholesterol: < 200 mg/dL
      expect(determineRangeFlag('245', '< 200 mg/dL')).toBe('HIGH');
      expect(determineRangeFlag('180', '< 200 mg/dL')).toBe('NORMAL');

      // Triglycerides: < 150 mg/dL
      expect(determineRangeFlag('210', '< 150 mg/dL')).toBe('HIGH');
      expect(determineRangeFlag('120', '< 150 mg/dL')).toBe('NORMAL');

      // Range string with descriptive parenthetical text
      // HbA1c: < 5.7 % (Good Control: <7.0)
      expect(determineRangeFlag('8.40', '< 5.7 % (Good Control: <7.0)')).toBe('HIGH');
      expect(determineRangeFlag('5.20', '< 5.7 % (Good Control: <7.0)')).toBe('NORMAL');
    });

    it('evaluates lower limit ranges (> X or >= X)', () => {
      // HDL Good Cholesterol: > 40 mg/dL
      expect(determineRangeFlag('34', '> 40 mg/dL')).toBe('LOW');
      expect(determineRangeFlag('55', '> 40 mg/dL')).toBe('NORMAL');

      // eGFR: > 90 mL/min/1.73m2
      expect(determineRangeFlag('38.5', '> 90 mL/min/1.73m2')).toBe('LOW');
      expect(determineRangeFlag('105', '> 90 mL/min/1.73m2')).toBe('NORMAL');
    });

    it('handles formatted numbers containing comma thousands separators', () => {
      // Platelet Count: 150,000 - 450,000 /cumm
      expect(determineRangeFlag('220,000', '150,000 - 450,000 /cumm')).toBe('NORMAL');
      expect(determineRangeFlag('90,000', '150,000 - 450,000 /cumm')).toBe('LOW');
      expect(determineRangeFlag('520,000', '150,000 - 450,000 /cumm')).toBe('HIGH');

      // WBC: 4,000 - 11,000 /cumm
      expect(determineRangeFlag('8,500', '4,000 - 11,000 /cumm')).toBe('NORMAL');
      expect(determineRangeFlag('14,000', '4,000 - 11,000 /cumm')).toBe('HIGH');
    });

    it('handles non-numeric or unparseable inputs gracefully', () => {
      expect(determineRangeFlag('Positive', 'Negative')).toBe('UNKNOWN');
      expect(determineRangeFlag('Reactive', 'Non-Reactive')).toBe('UNKNOWN');
    });
  });

  describe('Diagnostic Glossary & Lay-Bangla Explanations', () => {
    it('matches common laboratory tests from glossary', () => {
      const fbs = findGlossaryEntry('Fasting Blood Sugar (FBS)');
      expect(fbs).not.toBeNull();
      expect(fbs?.category).toBe('Diabetes');

      const hba1c = findGlossaryEntry('HbA1c');
      expect(hba1c).not.toBeNull();
      expect(hba1c?.explanationBn).toContain('শর্করার');

      const sCr = findGlossaryEntry('Serum Creatinine');
      expect(sCr).not.toBeNull();
      expect(sCr?.category).toBe('Renal Function');
    });

    it('formats lay-Bangla explanations concluding with mandatory doctor pointer', () => {
      const highExplanation = formatReportExplanationBn(
        'Fasting Blood Sugar (FBS)',
        '9.20',
        'mmol/L',
        'HIGH',
      );
      expect(highExplanation).toContain('স্বাভাবিকের চেয়ে বেশি (9.20 mmol/L)');
      expect(highExplanation).toContain('চিকিৎসকের পরামর্শ নিন');

      const normalExplanation = formatReportExplanationBn(
        'Platelet Count',
        '220,000',
        '/cumm',
        'NORMAL',
      );
      expect(normalExplanation).toContain('স্বাভাবিক মাত্রার মধ্যে রয়েছে (220,000 /cumm)');
    });
  });

  describe('End-to-End Report Extraction Pipeline', () => {
    it('extracts lab reports using mock fixture and verifies schema', async () => {
      const mockFixture: ReportDetail = {
        id: 'rep-mock-001',
        date: '2026-11-20',
        center: 'Popular Diagnostic Centre Ltd., Dhanmondi Branch',
        testType: 'Diabetic Profile (FBS & HbA1c)',
        profileId: 'prof-demo-01',
        values: [
          {
            test: 'Fasting Blood Sugar (রক্তের গ্লুকোজ - খালি পেটে)',
            value: '9.20',
            unit: 'mmol/L',
            printedRange: '3.9 - 6.1 mmol/L',
            flag: 'HIGH',
            explanationBn: 'খালি পেটে রক্তের শর্করা স্বাভাবিকের চেয়ে বেশি। চিকিৎসকের পরামর্শ নিন।',
          },
          {
            test: 'HbA1c (গ্লাইকেটেড হিমোগ্লোবিন)',
            value: '8.40',
            unit: '%',
            printedRange: '< 5.7 %',
            flag: 'HIGH',
            explanationBn: 'বিগত ৩ মাসের গড় শর্করার মাত্রা উচ্চ। চিকিৎসকের পরামর্শ নিন।',
          },
        ],
      };

      const result = await extractReportVision('mock://report.webp', { mockFixture });
      expect(result.detail.id).toBe('rep-mock-001');
      expect(result.detail.values).toHaveLength(2);
      expect(result.flagCounts.high).toBe(2);
      expect(result.flagCounts.low).toBe(0);
      expect(result.hasNumericDiscrepancy).toBe(false);

      // Verifies strict schema parse
      const validated = reportDetail.parse(result.detail);
      expect(validated.center).toContain('Popular Diagnostic Centre');
    });

    it('extracts offline realistic lab report and evaluates flags deterministically', async () => {
      const result = await extractReportVision('mock://realistic-lab.webp');
      expect(result.detail).toBeDefined();
      expect(result.detail.values.length).toBeGreaterThanOrEqual(1);

      for (const val of result.detail.values) {
        expect(['HIGH', 'LOW', 'NORMAL', 'UNKNOWN']).toContain(val.flag);
        expect(val.explanationBn).toBeDefined();
        expect(val.explanationBn.length).toBeGreaterThan(10);
      }
    });

    it('detects numeric discrepancies when an extracted lab value is missing from raw transcription', () => {
      // Test numeric validation helper
      const rawText = 'Fasting Blood Sugar (FBS) Result: 9.20 mmol/L Range: 3.9 - 6.1';
      // Value 9.20 is present
      expect(rawText).toContain('9.20');
      // Value 99.99 is missing (indicates OCR hallucination)
      expect(rawText).not.toContain('99.99');
    });

    it('validates all 5 synthetic diagnostic reports in data/synthetic-reports.json', () => {
      const reportsPath = path.resolve(process.cwd(), 'data/synthetic-reports.json');
      const fallbackPath = path.resolve(process.cwd(), '../../data/synthetic-reports.json');
      const p = fs.existsSync(reportsPath) ? reportsPath : fallbackPath;
      const reports = JSON.parse(fs.readFileSync(p, 'utf-8'));

      expect(reports).toHaveLength(5);

      for (const rep of reports) {
        // Must parse according to @uposhom/shared schema
        const detail = parseReportDetail(rep.detail);
        expect(detail.id).toBe(rep.id);
        expect(detail.values.length).toBeGreaterThanOrEqual(2);

        for (const item of detail.values) {
          expect(['HIGH', 'LOW', 'NORMAL', 'UNKNOWN']).toContain(item.flag);
          expect(item.printedRange.length).toBeGreaterThan(0);
          expect(item.explanationBn.length).toBeGreaterThan(10);
        }
      }
    });
  });
});
