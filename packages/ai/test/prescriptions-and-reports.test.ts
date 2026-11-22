import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  extractedItem,
  confirmItem,
  reportDetail,
} from '@uposhom/shared';
import { determineRangeFlag, lookupGlossaryExplanation } from '../src/vision/report-vault.js';

describe('Medical Data Integrity & Synthetic Fixture Validation', () => {
  const dataDir = path.resolve(process.cwd(), '../../data');
  const rxDir = path.join(dataDir, 'synthetic-prescriptions');

  describe('15 Synthetic Prescriptions (Day 0 Requirement)', () => {
    it('has exactly 15 prescription files plus index.json', () => {
      const files = fs.readdirSync(rxDir).filter((f) => f.startsWith('rx-synth-') && f.endsWith('.json'));
      expect(files.length).toBe(15);
    });

    it('contains both printed and handwritten styles', () => {
      const files = fs.readdirSync(rxDir).filter((f) => f.startsWith('rx-synth-') && f.endsWith('.json'));
      const styles = new Set<string>();

      for (const file of files) {
        const content = JSON.parse(fs.readFileSync(path.join(rxDir, file), 'utf-8'));
        styles.add(content.style);
      }

      expect(styles.has('printed')).toBe(true);
      expect(styles.has('handwritten')).toBe(true);
    });

    it('validates every extracted item and confirmed item against zod schema', () => {
      const files = fs.readdirSync(rxDir).filter((f) => f.startsWith('rx-synth-') && f.endsWith('.json'));

      for (const file of files) {
        const content = JSON.parse(fs.readFileSync(path.join(rxDir, file), 'utf-8'));

        expect(content.extractedItems.length).toBeGreaterThan(0);
        for (const item of content.extractedItems) {
          const parsed = extractedItem.safeParse(item);
          expect(parsed.success, `Failed validating extractedItem in ${file}: ${JSON.stringify(parsed)}`).toBe(true);
        }

        expect(content.confirmedItems.length).toBeGreaterThan(0);
        for (const item of content.confirmedItems) {
          const parsed = confirmItem.safeParse(item);
          expect(parsed.success, `Failed validating confirmItem in ${file}: ${JSON.stringify(parsed)}`).toBe(true);
        }
      }
    });

    it('flags critical cardiovascular and antibiotic medicines as isCritical: true', () => {
      const rx2 = JSON.parse(fs.readFileSync(path.join(rxDir, 'rx-synth-002.json'), 'utf-8'));
      const camlod = rx2.confirmedItems.find((i: { brandName: string; isCritical?: boolean }) => i.brandName === 'Camlod');
      expect(camlod?.isCritical).toBe(true);

      const rx4 = JSON.parse(fs.readFileSync(path.join(rxDir, 'rx-synth-004.json'), 'utf-8'));
      const zithrox = rx4.confirmedItems.find((i: { brandName: string; isCritical?: boolean }) => i.brandName === 'Zithrox');
      expect(zithrox?.isCritical).toBe(true);
    });
  });

  describe('5 Synthetic Lab Reports (Day 0 Requirement)', () => {
    const reportsPath = path.join(dataDir, 'synthetic-reports.json');

    it('contains 5 detailed lab reports conforming to @uposhom/shared', () => {
      const reports = JSON.parse(fs.readFileSync(reportsPath, 'utf-8'));
      expect(reports.length).toBe(5);

      for (const rep of reports) {
        const parsed = reportDetail.safeParse(rep.detail);
        expect(parsed.success, `Report ${rep.id} failed zod validation`).toBe(true);
      }
    });

    it('accurately calculates HIGH, LOW, and NORMAL range flags', () => {
      expect(determineRangeFlag('9.2', '3.9 - 6.1')).toBe('HIGH');
      expect(determineRangeFlag('2.5', '3.9 - 6.1')).toBe('LOW');
      expect(determineRangeFlag('4.8', '3.9 - 6.1')).toBe('NORMAL');

      expect(determineRangeFlag('245', '< 200')).toBe('HIGH');
      expect(determineRangeFlag('180', '< 200')).toBe('NORMAL');

      expect(determineRangeFlag('34', '> 40')).toBe('LOW');
      expect(determineRangeFlag('48', '> 40')).toBe('NORMAL');
    });
  });

  describe('DGDA Drug Catalog & Lab Glossary Catalog', () => {
    it('has 150+ hand-verified DGDA medicine records with Bangla aliases', () => {
      const drugsPath = path.join(dataDir, 'dgda-drugs.json');
      const drugs = JSON.parse(fs.readFileSync(drugsPath, 'utf-8'));

      expect(drugs.length).toBeGreaterThanOrEqual(150);
      for (const d of drugs) {
        expect(d.nameEn).toBeDefined();
        expect(d.nameBn).toBeDefined();
        expect(d.generic).toBeDefined();
        expect(d.strength).toBeDefined();
        expect(d.indicativePrice).toBeGreaterThan(0);
        expect(Array.isArray(d.bnAliases)).toBe(true);
        expect(d.verified).toBe(true);
      }
    });

    it('has 40 common lab tests in glossary with lay-Bangla explanations', () => {
      const glossaryPath = path.join(dataDir, 'glossary.json');
      const glossary = JSON.parse(fs.readFileSync(glossaryPath, 'utf-8'));

      expect(glossary.length).toBe(40);
      for (const item of glossary) {
        expect(item.id).toBeDefined();
        expect(item.testName).toBeDefined();
        expect(item.explanationBn).toBeDefined();
        expect(item.explanationBn).toContain('চিকিৎসক');
      }
    });

    it('looks up glossary explanations correctly', () => {
      const explanation = lookupGlossaryExplanation('Fasting Blood Sugar');
      expect(explanation).toContain('শর্করার');
    });
  });
});
