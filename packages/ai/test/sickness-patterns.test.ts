import { describe, it, expect } from 'vitest';
import {
  loadSyntheticHistory,
  loadHealthTips,
  aggregateTimelineByMonth,
  detectSicknessPatterns,
  getProfileInsights,
} from '../src/analytics/sickness-patterns.js';
import { insightsResponse, type TimelineEntry } from '@uposhom/shared';

describe('Sickness-Pattern Analytics & Seasonal Timeline Aggregates', () => {
  it('loads synthetic history seed file with 16 timeline records and curated patterns', () => {
    const seed = loadSyntheticHistory();
    expect(seed).not.toBeNull();
    expect(seed?.profileId).toBe('prof-demo-insights-01');
    expect(seed?.timeline.length).toBe(16);
    expect(seed?.patterns.length).toBe(2);
  });

  it('loads curated health tips from data/health-tips.json', () => {
    const tips = loadHealthTips();
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.some((t) => t.tags?.includes('antibiotic') || t.category === 'medication_safety')).toBe(true);
  });

  it('correctly aggregates timeline entries by month', () => {
    const sampleTimeline: TimelineEntry[] = [
      { id: '1', date: '2026-01-10', kind: 'SYMPTOM', title: 'কাশি' },
      { id: '2', date: '2026-01-15', kind: 'PRESCRIPTION', title: 'Napa' },
      { id: '3', date: '2026-02-05', kind: 'SYMPTOM', title: 'জ্বর' },
      { id: '4', date: '2026-02-20', kind: 'PRESCRIPTION', title: 'Cef-3' },
      { id: '5', date: '2026-02-22', kind: 'PRESCRIPTION', title: 'Monas' },
    ];

    const monthlyCounts = aggregateTimelineByMonth(sampleTimeline);
    expect(monthlyCounts['2026-01']).toBe(2);
    expect(monthlyCounts['2026-02']).toBe(3);
  });

  it('detects winter respiratory spike pattern from chronological data', () => {
    const seed = loadSyntheticHistory();
    const detected = detectSicknessPatterns(seed?.timeline || []);

    const winterPattern = detected.find((p) => p.id.includes('respiratory'));
    expect(winterPattern).toBeDefined();
    expect(winterPattern?.sentenceBn).toContain('শীত মৌসুমে');
    expect(winterPattern?.tipBn).toContain('অ্যান্টিবায়োটিক');
    expect(winterPattern?.monthly.length).toBeGreaterThan(0);
  });

  it('detects chronic maintenance medication continuity pattern', () => {
    const seed = loadSyntheticHistory();
    const detected = detectSicknessPatterns(seed?.timeline || []);

    const chronicPattern = detected.find((p) => p.id.includes('chronic'));
    expect(chronicPattern).toBeDefined();
    expect(chronicPattern?.sentenceBn).toContain('রক্তচাপ');
    expect(chronicPattern?.tipBn).toContain('রক্তচাপ');
  });

  it('returns valid InsightsResponse conforming to @uposhom/shared schema', () => {
    const insights = getProfileInsights('prof-demo-insights-01', { isPremium: true });

    expect(insightsResponse.safeParse(insights).success).toBe(true);
    expect(insights.timeline.length).toBeGreaterThanOrEqual(16);
    expect(insights.patterns.length).toBeGreaterThanOrEqual(1);
    expect(insights.patternsLocked).toBe(false);
  });

  it('locks patterns for Free tier circles according to Freemium entitlements', () => {
    const freeInsights = getProfileInsights('prof-demo-insights-01', { isPremium: false });

    expect(freeInsights.patternsLocked).toBe(true);
    expect(freeInsights.patterns).toEqual([]);
    expect(freeInsights.timeline.length).toBeGreaterThan(0);
  });
});
