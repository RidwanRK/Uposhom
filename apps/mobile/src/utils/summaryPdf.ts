import type { DoctorSummary } from '@uposhom/shared';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

export interface SummaryLabels {
  title: string;
  symptoms: string;
  onset: string;
  duration: string;
  severity: string;
  triggers: string;
  associated: string;
  medicines: string;
  recent: string;
  disclaimer: string;
}

/**
 * HTML for the doctor summary PDF, rendered on the phone by expo-print. It only lays out the structured
 * summary the server produced; every value is HTML-escaped. It states plainly that it is not a diagnosis.
 */
export function summaryHtml(
  s: DoctorSummary,
  profileName: string,
  dateText: string,
  l: SummaryLabels,
): string {
  const row = (label: string, value?: string) =>
    value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : '';
  const list = (items: string[]) => (items.length ? items.map(esc).join('<br/>') : '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"/>
<style>
  body { font-family: 'Noto Sans Bengali', 'Noto Sans', sans-serif; color: #1a2421; padding: 24px; font-size: 16px; line-height: 1.6; }
  h1 { color: #0d5c52; font-size: 24px; margin: 0 0 4px; }
  .meta { color: #3f4d49; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; width: 34%; vertical-align: top; padding: 8px; background: #e8f5e9; border: 1px solid #b2c7c1; }
  td { padding: 8px; border: 1px solid #b2c7c1; vertical-align: top; }
  .note { margin-top: 20px; padding: 12px; background: #f6faf8; border: 1px solid #b2c7c1; color: #3f4d49; }
</style></head><body>
<h1>${esc(l.title)}</h1>
<div class="meta">${esc(profileName)} · ${esc(dateText)}</div>
<table>
${row(l.symptoms, s.symptoms)}${row(l.onset, s.onset)}${row(l.duration, s.duration)}${row(l.severity, s.severity)}${row(l.triggers, s.triggers)}${row(l.associated, s.associated)}
<tr><th>${esc(l.medicines)}</th><td>${list(s.currentMedicines)}</td></tr>
<tr><th>${esc(l.recent)}</th><td>${list(s.recentPrescriptions)}</td></tr>
</table>
<div class="note">${esc(l.disclaimer)}</div>
</body></html>`;
}
