/**
 * Doctor Summary Generator & Clinical PDF / HTML Formatter
 *
 * Implements Master Plan section 5 (Doctor Summary PDF):
 * - Formats patient symptom journal entries into a clean clinical brief for physician consultations.
 * - Joins active prescription items and recent medical history.
 * - Strict Non-LLM Boundary: Does NOT give medical diagnoses or alter prescriptions.
 * - Always includes explicit medical disclaimer.
 * - Generates clean HTML template ready for expo-print / PDF export.
 */

import { type DoctorSummary, doctorSummary } from '@uposhom/shared';

export interface DoctorSummaryOptions {
  profileName?: string;
  age?: number;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  circleName?: string;
  consultationDate?: string;
  notes?: string;
}

export const DOCTOR_SUMMARY_DISCLAIMER_BN =
  'চিকিৎসকের অবগতির জন্য: এটি রোগীর নিজের ভাষায় বর্ণিত শারীরিক উপসর্গের একটি প্রাথমিক সারসংক্ষেপ। এটি কোনো ক্লিনিক্যাল ডায়াগনোসিস বা চিকিৎসাপত্র নয়। চূড়ান্ত রোগ নির্ণয় ও চিকিৎসা পরামর্শকারী রেজিস্ট্রার্ড চিকিৎসকের এখতিয়ারাধীন।';

/**
 * Builds and validates a structured DoctorSummary object.
 */
export function createDoctorSummary(
  params: {
    id?: string;
    symptoms: string;
    onset?: string;
    duration?: string;
    severity?: string;
    triggers?: string;
    associated?: string;
    currentMedicines?: string[];
    recentPrescriptions?: string[];
    createdAt?: string;
  },
): DoctorSummary {
  const summary: DoctorSummary = {
    id: params.id || `doc-sum-${Date.now()}`,
    symptoms: params.symptoms.trim(),
    onset: params.onset?.trim() || 'অনুল্লেখিত',
    duration: params.duration?.trim() || 'অনুল্লেখিত',
    severity: params.severity?.trim() || 'অনুল্লেখিত',
    triggers: params.triggers?.trim() || 'অনুল্লেখিত',
    associated: params.associated?.trim() || 'অনুল্লেখিত',
    currentMedicines: params.currentMedicines || [],
    recentPrescriptions: params.recentPrescriptions || [],
    createdAt: params.createdAt || new Date().toISOString(),
  };

  return doctorSummary.parse(summary);
}

/**
 * Generates an HTML consultation document ready for mobile PDF rendering / printing.
 */
export function renderDoctorSummaryHtml(
  summary: DoctorSummary,
  options: DoctorSummaryOptions = {},
): string {
  const patientName = options.profileName || 'রোগীর নাম অনুল্লেখিত';
  const ageGenderStr = [
    options.age ? `বয়স: ${options.age} বছর` : null,
    options.gender ? `লিঙ্গ: ${options.gender === 'MALE' ? 'পুরুষ' : options.gender === 'FEMALE' ? 'মহিলা' : 'অন্যান্য'}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const dateStr = options.consultationDate || new Date().toLocaleDateString('bn-BD', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const medsHtml =
    summary.currentMedicines.length > 0
      ? summary.currentMedicines.map((m) => `<li>${m}</li>`).join('')
      : '<li>বর্তমানে নিয়মিত কোনো ওষুধ লিপিবদ্ধ নেই</li>';

  const rxHtml =
    summary.recentPrescriptions.length > 0
      ? summary.recentPrescriptions.map((r) => `<li>${r}</li>`).join('')
      : '<li>সাম্প্রতিক কোনো প্রেসক্রিপশন সংরক্ষিত নেই</li>';

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <title>ডাক্তার সামারি - উপশম (${patientName})</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap');
    body {
      font-family: 'Noto Sans Bengali', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 32px 40px;
      line-height: 1.6;
      background: #ffffff;
    }
    .header {
      border-bottom: 2px solid #0284c7;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 700;
      color: #0284c7;
      margin: 0;
    }
    .doc-type {
      font-size: 16px;
      color: #475569;
      font-weight: 600;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 20px;
      margin-bottom: 24px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .meta-row:last-child {
      margin-bottom: 0;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      border-left: 4px solid #0284c7;
      padding-left: 10px;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    .symptom-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .symptom-table th, .symptom-table td {
      border: 1px solid #e2e8f0;
      padding: 10px 14px;
      text-align: left;
    }
    .symptom-table th {
      background-color: #f1f5f9;
      color: #334155;
      width: 30%;
    }
    ul {
      margin: 6px 0;
      padding-left: 20px;
    }
    li {
      margin-bottom: 4px;
    }
    .disclaimer-box {
      margin-top: 36px;
      padding: 14px 18px;
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      font-size: 13px;
      color: #991b1b;
    }
    .footer {
      margin-top: 28px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand-title">উপশম (Uposhom)</h1>
      <div class="doc-type">ডাক্তার ভিজিট সামারি ও রোগী লক্ষণ বিবরণী</div>
    </div>
    <div style="text-align: right; font-size: 13px; color: #64748b;">
      তারিখ: ${dateStr}<br>
      আইডি: ${summary.id || 'N/A'}
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-row">
      <span><strong>রোগীর নাম:</strong> ${patientName}</span>
      <span>${ageGenderStr}</span>
    </div>
    ${options.circleName ? `<div class="meta-row"><span><strong>পরিবার সার্কেল:</strong> ${options.circleName}</span></div>` : ''}
  </div>

  <div class="section-title">১. প্রধান শারীরিক সমস্যা ও উপসর্গের বিবরণ</div>
  <table class="symptom-table">
    <tr>
      <th>প্রধান সমস্যা (Chief Complaint)</th>
      <td><strong>${summary.symptoms}</strong></td>
    </tr>
    <tr>
      <th>কখন শুরু হয়েছে (Onset)</th>
      <td>${summary.onset || 'অনুল্লেখিত'}</td>
    </tr>
    <tr>
      <th>স্থায়িত্ব ও প্রকৃতি (Duration)</th>
      <td>${summary.duration || 'অনুল্লেখিত'}</td>
    </tr>
    <tr>
      <th>তীব্রতা (Severity)</th>
      <td>${summary.severity || 'অনুল্লেখিত'}</td>
    </tr>
    <tr>
      <th>উদ্দীপক / কিসে বাড়ে (Triggers)</th>
      <td>${summary.triggers || 'অনুল্লেখিত'}</td>
    </tr>
    <tr>
      <th>অনুষঙ্গিক উপসর্গ (Associated)</th>
      <td>${summary.associated || 'অনুল্লেখিত'}</td>
    </tr>
  </table>

  <div class="section-title">২. বর্তমান নিয়মিত ওষুধসমূহ (Current Medications)</div>
  <ul>
    ${medsHtml}
  </ul>

  <div class="section-title">৩. সাম্প্রতিক প্রেসক্রিপশন হিস্ট্রি (Recent Prescriptions)</div>
  <ul>
    ${rxHtml}
  </ul>

  <div class="disclaimer-box">
    <strong>সতর্কবার্তা:</strong> ${DOCTOR_SUMMARY_DISCLAIMER_BN}
  </div>

  <div class="footer">
    উপশম হেলথকেয়ার অ্যাসিস্ট্যান্ট · বাংলা ডিজিটাল স্বাস্থ্য সেবা প্ল্যাটফর্ম · www.uposhom.health
  </div>
</body>
</html>`;
}
