/**
 * Multi-Turn Symptom Journaling Engine with Deterministic Red-Flag Guard
 *
 * Implements Master Plan section 5 (AI-guided Symptom Journaling):
 * - Conducts structured, empathetic slot-filling intake Q&A flow in Bangla.
 * - Non-LLM Boundary: checkRedFlagKeywords runs first on every turn for 0-latency 999 routing.
 * - Extracts and tracks slots: chiefComplaint, onset, duration, severity, triggers, associated, currentMedicines.
 * - Produces a verified DoctorSummary complying with @uposhom/shared schemas.
 * - Safety Invariant: Never diagnoses, prescribes, or claims unverified medical judgments.
 */

import {
  type JournalBody,
  type JournalResponse,
  type DoctorSummary,
  journalResponse,
} from '@uposhom/shared';
import { checkRedFlagKeywords } from '../guards/redflag-guard.js';

export interface SymptomSession {
  sessionId: string;
  profileId: string;
  channel: 'TEXT' | 'VOICE';
  slots: Record<string, string>;
  questionIndex: number;
  createdAt: number;
  updatedAt: number;
}

export const JOURNAL_SLOTS = [
  { key: 'onset', labelBn: 'শুরু হওয়ার সময়', questionBn: 'আপনার এই সমস্যাটি ঠিক কখন বা কতদিন আগে থেকে শুরু হয়েছে?' },
  { key: 'duration', labelBn: 'স্থায়িত্ব ও ধরন', questionBn: 'লক্ষণটি কি একটানা থাকে, নাকি নির্দিষ্ট কোনো সময়ে বাড়ে-কমে?' },
  { key: 'severity', labelBn: 'তীব্রতা', questionBn: 'সমস্যার তীব্রতা কেমন মনে হচ্ছে—হালকা, মাঝারি নাকি খুব বেশি তীব্র?' },
  { key: 'triggers', labelBn: 'উদ্দীপক বা কারণ', questionBn: 'কোনো নির্দিষ্ট খাবার, পরিশ্রম, আবহাওয়া বা কাজের কারণে এটি বাড়ে বা কমে কি?' },
  { key: 'associated', labelBn: 'অনুষঙ্গিক লক্ষণ', questionBn: 'এর পাশাপাশি অন্য কোনো উপসর্গ (যেমন জ্বর, বমি, ক্লান্তি বা শ্বাসকষ্ট) আছে কি?' },
  { key: 'currentMedicines', labelBn: 'বর্তমান ওষুধ', questionBn: 'বর্তমানে এই সমস্যার জন্য বা অন্য কোনো রোগের জন্য কোনো ওষুধ সেবন করছেন কি?' },
] as const;

// Session store for active journaling consultations (in-memory with TTL)
const activeSessions = new Map<string, SymptomSession>();

/**
 * Resets or clears stored sessions (useful for tests).
 */
export function clearAllSymptomSessions(): void {
  activeSessions.clear();
}

/**
 * Retrieves an active session by ID.
 */
export function getSymptomSession(sessionId: string): SymptomSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Normalizes severity into a clean Bengali tag if recognizable.
 */
function normalizeSeverity(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('তীব্র') || lower.includes('বেশি') || lower.includes('severe') || lower.includes('অনেক')) {
    return 'তীব্র (Severe)';
  }
  if (lower.includes('মাঝারি') || lower.includes('moderate')) {
    return 'মাঝারি (Moderate)';
  }
  if (lower.includes('হালকা') || lower.includes('মৃদু') || lower.includes('mild') || lower.includes('কম')) {
    return 'হালকা (Mild)';
  }
  return text.trim();
}

/**
 * Executes a turn in the AI-guided symptom journaling flow.
 */
export async function processJournalTurn(body: JournalBody): Promise<JournalResponse> {
  const { profileId, inputText, channel, skip } = body;

  // Step 1: 0-Latency Red-Flag Interceptor
  const redFlag = checkRedFlagKeywords(inputText);
  if (redFlag.isEmergency) {
    if (body.sessionId) {
      activeSessions.delete(body.sessionId);
    }
    const response: JournalResponse = {
      isRedFlag: true,
      alertMessage:
        redFlag.immediateBanglaAlert ||
        `🚨 জরুরি সতর্কতা: আপনার বর্ণনায় বিপজ্জনক লক্ষণ (${redFlag.matchedKeyword || 'সংকটজনক অবস্থা'}) চিহ্নিত হয়েছে। অবিলম্বে ৯৯৯ এ কল করুন অথবা নিকটস্থ হাসপাতালে যান।`,
      emergencyDial: '999',
      doctorSummaryReady: false,
    };
    return journalResponse.parse(response);
  }

  // Step 2: Retrieve or initialize session
  let session: SymptomSession;
  const sessionId = body.sessionId || `sess-sym-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (body.sessionId && activeSessions.has(body.sessionId)) {
    session = activeSessions.get(body.sessionId)!;
    session.updatedAt = Date.now();
  } else {
    session = {
      sessionId,
      profileId,
      channel,
      slots: {
        chiefComplaint: inputText.trim(),
      },
      questionIndex: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    activeSessions.set(sessionId, session);
  }

  // Step 3: Handle Turn Progression
  const questionTotal = JOURNAL_SLOTS.length;

  // If this was an existing session and user provided input for the current question
  if (body.sessionId && session.questionIndex < questionTotal) {
    const currentSlot = JOURNAL_SLOTS[session.questionIndex];
    if (currentSlot) {
      if (skip) {
        session.slots[currentSlot.key] = 'উল্লেখ করা হয়নি';
      } else {
        const val = currentSlot.key === 'severity' ? normalizeSeverity(inputText) : inputText.trim();
        session.slots[currentSlot.key] = val;
      }
      session.questionIndex += 1;
    }
  }

  // Step 4: Check if more questions remain
  if (session.questionIndex < questionTotal) {
    const nextSlot = JOURNAL_SLOTS[session.questionIndex];
    const response: JournalResponse = {
      isRedFlag: false,
      sessionId: session.sessionId,
      collectedSlots: { ...session.slots },
      doctorSummaryReady: false,
      nextQuestion: nextSlot?.questionBn || null,
      questionIndex: session.questionIndex + 1,
      questionTotal,
    };
    return journalResponse.parse(response);
  }

  // Step 5: All slots collected — Build Doctor Summary
  const summary: DoctorSummary = {
    id: `doc-sum-${Date.now()}`,
    symptoms: session.slots.chiefComplaint || 'শারীরিক অস্বস্তি',
    onset: session.slots.onset,
    duration: session.slots.duration,
    severity: session.slots.severity,
    triggers: session.slots.triggers,
    associated: session.slots.associated,
    currentMedicines: session.slots.currentMedicines ? [session.slots.currentMedicines] : [],
    recentPrescriptions: [],
    createdAt: new Date().toISOString(),
  };

  const response: JournalResponse = {
    isRedFlag: false,
    sessionId: session.sessionId,
    collectedSlots: { ...session.slots },
    doctorSummaryReady: true,
    nextQuestion: null,
    questionIndex: questionTotal,
    questionTotal,
    summary,
  };

  // Clean up completed session
  activeSessions.delete(session.sessionId);

  return journalResponse.parse(response);
}
