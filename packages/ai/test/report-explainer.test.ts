import { describe, it, expect } from 'vitest';
import type { ReportDetail } from '@uposhom/shared';
import {
  explainDiagnosticReport,
  validateReportNumericOutput,
  extractAllowedNumbersFromReport,
} from '../src/explainer/report-explainer.js';

describe('Diagnostic Report Explainer & Numeric Guard', () => {
  const normalReport: ReportDetail = {
    id: 'rep-cbc-norm',
    date: '2026-11-20',
    center: 'Popular Diagnostic Centre, Dhanmondi',
    testType: 'Complete Blood Count (CBC)',
    values: [
      {
        test: 'Hemoglobin (হিমোগ্লোবিন - রক্তকণিকা)',
        value: '14.5',
        unit: 'g/dL',
        printedRange: '13.0 - 17.0 g/dL',
        flag: 'NORMAL',
        explanationBn: 'রক্তের লোহিত কণিকায় অক্সিজেন বহনকারী উপাদান।',
      },
      {
        test: 'Platelet Count (প্লাটিলেট বা অনুচক্রিকা)',
        value: '250000',
        unit: '/cumm',
        printedRange: '150,000 - 450,000 /cumm',
        flag: 'NORMAL',
        explanationBn: 'রক্ত জমাট বাঁধতে সাহায্যকারী কোষ।',
      },
    ],
  };

  const abnormalDiabeticReport: ReportDetail = {
    id: 'rep-diab-abn',
    date: '2026-11-21',
    center: 'Ibn Sina Diagnostic Centre',
    testType: 'Diabetic Profile',
    values: [
      {
        test: 'Fasting Blood Sugar (রক্তের গ্লুকোজ - খালি পেটে)',
        value: '9.2',
        unit: 'mmol/L',
        printedRange: '3.9 - 6.1 mmol/L',
        flag: 'HIGH',
        explanationBn: 'খালি পেটে রক্তের শর্করা নির্দেশ করে।',
      },
      {
        test: 'HbA1c (গ্লাইকেটেড হিমোগ্লোবিন - ৩ মাসের গড় শর্করা)',
        value: '8.1',
        unit: '%',
        printedRange: '< 5.7 %',
        flag: 'HIGH',
        explanationBn: 'বিগত তিন মাসের গড় শর্করা নিয়ন্ত্রণ প্রকাশ করে।',
      },
    ],
  };

  it('produces reassuring explanation for normal diagnostic report', () => {
    const result = explainDiagnosticReport(normalReport);

    expect(result.abnormalCount).toBe(0);
    expect(result.normalCount).toBe(2);
    expect(result.summaryBn).toContain('স্বাভাবিক');
    expect(result.doctorAdviceBn).toContain('চিকিৎসক');
    expect(result.items.every((i) => !i.isAbnormal)).toBe(true);
  });

  it('identifies and highlights abnormal test flags with lay-Bangla guidance', () => {
    const result = explainDiagnosticReport(abnormalDiabeticReport);

    expect(result.abnormalCount).toBe(2);
    expect(result.highFlaggedItems.length).toBe(2);
    expect(result.summaryBn).toContain('পরিবর্তন দেখা গেছে');
    expect(result.summaryBn).toContain('Fasting Blood Sugar');
    expect(result.doctorAdviceBn).toContain('রেজিস্টার্ড চিকিৎসকের সরাসরি পরামর্শ নিন');
    expect(result.highFlaggedItems[0]?.guidanceBn).toContain('স্বাভাবিক মাত্রার চেয়ে বেশি');
  });

  it('deterministically recalculates flag if reported as UNKNOWN', () => {
    const reportWithUnknown: ReportDetail = {
      id: 'rep-lipid-unk',
      date: '2026-11-22',
      center: 'Square Hospitals Lab',
      testType: 'Lipid Profile',
      values: [
        {
          test: 'Total Cholesterol',
          value: '240',
          unit: 'mg/dL',
          printedRange: '< 200 mg/dL',
          flag: 'UNKNOWN',
          explanationBn: '',
        },
      ],
    };

    const result = explainDiagnosticReport(reportWithUnknown);
    expect(result.items[0]?.flag).toBe('HIGH');
    expect(result.abnormalCount).toBe(1);
  });

  it('adheres to strict non-diagnostic boundary and instructs patient to see doctor', () => {
    const result = explainDiagnosticReport(abnormalDiabeticReport);

    // Non-diagnostic invariant: Does not claim definitive disease or prescribe changes
    expect(result.summaryBn).toContain('চূড়ান্ত রোগ নির্দেশ করে না');
    expect(result.doctorAdviceBn).toContain('নিজে থেকে কোনো ওষুধ গ্রহণ, পরিবর্তন বা বন্ধ করবেন না');
  });

  it('numeric guard permits valid numbers existing in report data', () => {
    const allowed = extractAllowedNumbersFromReport(abnormalDiabeticReport);
    expect(allowed.has('9.2')).toBe(true);
    expect(allowed.has('8.1')).toBe(true);
    expect(allowed.has('3.9')).toBe(true);
    expect(allowed.has('6.1')).toBe(true);
    expect(allowed.has('5.7')).toBe(true);

    const validCustom = 'আপনার পরীক্ষার ফলাফল ৯.২ এবং ৮.১ পাওয়া গেছে। ডাক্তারের সাথে কথা বলুন।';
    const guardReport = validateReportNumericOutput(validCustom, abnormalDiabeticReport);
    expect(guardReport.valid).toBe(true);
  });

  it('numeric guard rejects hallucinated numbers and falls back to deterministic template', () => {
    const hallucinatedSummary =
      'আপনার রক্তের চিনি ৫০০ পৌঁছে গেছে, প্রতিদিন ২৫০ মিলিগ্রাম করে মেটফরমিন সেবন করুন।';

    const result = explainDiagnosticReport(abnormalDiabeticReport, {
      customSummary: hallucinatedSummary,
    });

    expect(result.guarded).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.guardReport?.valid).toBe(false);
    expect(result.guardReport?.rejectedNumbers).toContain('500');
    expect(result.guardReport?.rejectedNumbers).toContain('250');
    // Ensure fabricated text was replaced with safe deterministic summary
    expect(result.summaryBn).not.toContain('৫০০');
    expect(result.summaryBn).not.toContain('২৫০');
  });
});
