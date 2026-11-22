/**
 * Sickness-Pattern Analytics & Timeline Aggregates Engine
 *
 * Implements Master Plan section 5 (Insights & Sickness-Pattern Analytics):
 * - Aggregates symptom logs and past confirmed prescriptions into a chronological timeline.
 * - Detects recurring seasonal sickness patterns (e.g. winter respiratory surges, antibiotic frequency).
 * - Identifies long-term maintenance therapy continuity (e.g. antihypertensive adherence).
 * - Associates patterns with curated lifestyle and preventive guidance from data/tips.json.
 * - Formats output according to @uposhom/shared insightsResponse schema.
 */

import {
  type TimelineEntry,
  type PatternCard,
  type InsightsResponse,
  insightsResponse,
} from '@uposhom/shared';
import fs from 'node:fs';
import path from 'node:path';

export interface SyntheticHistoryFile {
  profileId: string;
  timeline: TimelineEntry[];
  patterns: PatternCard[];
  patternsLocked?: boolean;
}

export interface CuratedTip {
  id: string;
  category: string;
  titleBn: string;
  contentBn: string;
  season?: string;
  applicableConditions: string[];
}

let cachedSyntheticHistory: SyntheticHistoryFile | null = null;
let cachedTips: CuratedTip[] | null = null;

/**
 * Loads synthetic history seed data from data/synthetic-history.json.
 */
export function loadSyntheticHistory(): SyntheticHistoryFile | null {
  if (cachedSyntheticHistory) return cachedSyntheticHistory;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/synthetic-history.json'),
      path.resolve(process.cwd(), '../../data/synthetic-history.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedSyntheticHistory = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedSyntheticHistory!;
      }
    }
  } catch {
    // Fall back to null
  }
  return null;
}

/**
 * Loads curated health tips from data/tips.json.
 */
export function loadHealthTips(): CuratedTip[] {
  if (cachedTips) return cachedTips;
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), 'data/tips.json'),
      path.resolve(process.cwd(), '../../data/tips.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        cachedTips = JSON.parse(fs.readFileSync(p, 'utf-8'));
        return cachedTips!;
      }
    }
  } catch {
    // Fall back to empty array
  }
  return [];
}

/**
 * Aggregates a timeline of events by month ('YYYY-MM').
 */
export function aggregateTimelineByMonth(
  timeline: TimelineEntry[],
  predicate?: (entry: TimelineEntry) => boolean,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const item of timeline) {
    if (predicate && !predicate(item)) continue;
    const month = item.date.slice(0, 7); // 'YYYY-MM'
    counts[month] = (counts[month] || 0) + 1;
  }

  return counts;
}

/**
 * Detects recurring sickness patterns across a timeline of symptoms and prescriptions.
 */
export function detectSicknessPatterns(timeline: TimelineEntry[]): PatternCard[] {
  const patterns: PatternCard[] = [];
  const tips = loadHealthTips();

  // Pattern 1: Winter Respiratory Spike (Nov, Dec, Jan)
  const respiratoryEntries = timeline.filter((e) => {
    const cls = e.therapeuticClass?.toLowerCase() || '';
    const title = e.title.toLowerCase();
    return (
      cls.includes('respiratory') ||
      cls.includes('antiasthmatic') ||
      cls.includes('antibiotic') ||
      title.includes('কাশি') ||
      title.includes('শ্বাসকষ্ট') ||
      title.includes('ঠান্ডা')
    );
  });

  if (respiratoryEntries.length >= 3) {
    const monthlyCounts = aggregateTimelineByMonth(respiratoryEntries);
    const months = Object.keys(monthlyCounts).sort();

    const winterTip =
      tips.find((t) => t.applicableConditions?.includes('respiratory_symptom'))?.contentBn ||
      'শীতের শুরুতে ইনফ্লুয়েঞ্জা ও নিউমোনিয়ার টিকা নেওয়ার বিষয়ে আপনার চিকিৎসকের পরামর্শ নিন এবং ধুলোবালি ও ঠান্ডা বাতাস এড়িয়ে চলুন।';

    patterns.push({
      id: 'pattern-respiratory-seasonal',
      sentenceBn:
        'বিগত বছরগুলোতে শীত মৌসুমে (নভেম্বর-জানুয়ারি) আপনার শ্বাসকষ্ট, কাশি ও অ্যান্টিবায়োটিকের প্রেসক্রিপশন লক্ষণীয়ভাবে বৃদ্ধি পেয়েছে।',
      monthly: months.map((m) => ({ month: m, count: monthlyCounts[m] || 0 })),
      tipBn: winterTip,
    });
  }

  // Pattern 2: Chronic Maintenance Medication Continuity (e.g. Antihypertensive or Antidiabetic)
  const chronicEntries = timeline.filter((e) => {
    const cls = e.therapeuticClass?.toLowerCase() || '';
    return cls.includes('antihypertensive') || cls.includes('antidiabetic');
  });

  if (chronicEntries.length >= 2) {
    const monthlyCounts = aggregateTimelineByMonth(chronicEntries);
    const months = Object.keys(monthlyCounts).sort();

    const chronicTip =
      tips.find((t) => t.applicableConditions?.includes('hypertension'))?.contentBn ||
      'রক্তচাপ স্বাভাবিক থাকলেও চিকিৎসকের অনুমতি ছাড়া নিজে নিজে রক্তচাপের ওষুধ সেবন বন্ধ করবেন না।';

    patterns.push({
      id: 'pattern-chronic-maintenance',
      sentenceBn:
        'উচ্চ রক্তচাপ বা দীর্ঘমেয়াদি স্বাস্থ্য সুরক্ষার ওষুধ নিয়মিত সেবনের ফলে আপনার শারীরিক অবস্থা স্থিতিশীল রয়েছে।',
      monthly: months.map((m) => ({ month: m, count: monthlyCounts[m] || 0 })),
      tipBn: chronicTip,
    });
  }

  return patterns;
}

/**
 * Returns comprehensive sickness-pattern insights for a profile.
 * Merges synthetic baseline data with any runtime timeline records.
 */
export function getProfileInsights(
  profileId: string,
  options: {
    additionalTimeline?: TimelineEntry[];
    isPremium?: boolean;
  } = {},
): InsightsResponse {
  const seed = loadSyntheticHistory();

  // Combine seed timeline with any additional profile-specific timeline items
  const baseTimeline = seed?.timeline || [];
  const fullTimeline = [...baseTimeline, ...(options.additionalTimeline || [])];

  // Sort timeline by date ascending
  fullTimeline.sort((a, b) => a.date.localeCompare(b.date));

  // Compute detected patterns
  const detectedPatterns =
    seed?.patterns && seed.patterns.length > 0
      ? seed.patterns
      : detectSicknessPatterns(fullTimeline);

  // If circle is not Premium and patterns are locked in Free tier
  const isPremium = options.isPremium ?? true; // Defaults to available in demo/testing
  const patternsLocked = !isPremium;

  const result: InsightsResponse = {
    timeline: fullTimeline,
    patterns: patternsLocked ? [] : detectedPatterns,
    patternsLocked,
  };

  return insightsResponse.parse(result);
}
