import { describe, it, expect, beforeEach } from 'vitest';
import {
  processJournalTurn,
  clearAllSymptomSessions,
  JOURNAL_SLOTS,
} from '../src/journaling/symptom-journal.js';
import {
  createDoctorSummary,
  renderDoctorSummaryHtml,
  DOCTOR_SUMMARY_DISCLAIMER_BN,
} from '../src/journaling/doctor-summary.js';
import { journalResponse, doctorSummary } from '@uposhom/shared';

describe('AI Symptom Journaling Engine & Clinical Summary', () => {
  beforeEach(() => {
    clearAllSymptomSessions();
  });

  it('initiates a new journal session and returns the first question', async () => {
    const res = await processJournalTurn({
      profileId: 'prof-user-1',
      inputText: 'আমার ৩ দিন ধরে শুকনো কাশি ও হালকা জ্বর হচ্ছে',
      channel: 'TEXT',
    });

    expect(journalResponse.safeParse(res).success).toBe(true);
    expect(res.isRedFlag).toBe(false);
    expect(res.doctorSummaryReady).toBe(false);
    expect(res.sessionId).toBeDefined();
    expect(res.questionIndex).toBe(1);
    expect(res.questionTotal).toBe(JOURNAL_SLOTS.length);
    expect(res.nextQuestion).toBe(JOURNAL_SLOTS[0]?.questionBn);
    expect(res.collectedSlots?.chiefComplaint).toContain('শুকনো কাশি ও হালকা জ্বর');
  });

  it('progresses through all intake slots and generates a DoctorSummary', async () => {
    // Turn 0: Initial complaint
    let turn = await processJournalTurn({
      profileId: 'prof-user-1',
      inputText: 'আমার মাথা ব্যথা করছে',
      channel: 'TEXT',
    });
    const sessionId = turn.sessionId!;

    // Turn 1: Onset
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'গত পরশু রাত থেকে শুরু হয়েছে',
      channel: 'TEXT',
    });
    expect(turn.questionIndex).toBe(2);
    expect(turn.collectedSlots?.onset).toBe('গত পরশু রাত থেকে শুরু হয়েছে');

    // Turn 2: Duration
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'দিনের বেলা বেশি থাকে, রাতে কিছুটা কমে',
      channel: 'TEXT',
    });
    expect(turn.questionIndex).toBe(3);

    // Turn 3: Severity (should normalize to Severe)
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'অনেক বেশি তীব্র ব্যথা',
      channel: 'TEXT',
    });
    expect(turn.collectedSlots?.severity).toContain('তীব্র (Severe)');

    // Turn 4: Triggers
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'রোদে গেলে বা মোবাইল বেশিক্ষণ দেখলে বাড়ে',
      channel: 'TEXT',
    });
    expect(turn.questionIndex).toBe(5);

    // Turn 5: Associated symptoms
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'সাথে হালকা বমি বমি ভাব আছে',
      channel: 'TEXT',
    });
    expect(turn.questionIndex).toBe(6);

    // Turn 6: Current medicines (Final question)
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: 'গতকাল একটা নাপা খেয়েছিলাম কিন্তু কমেনি',
      channel: 'TEXT',
    });

    // Check completion
    expect(turn.doctorSummaryReady).toBe(true);
    expect(turn.nextQuestion).toBeNull();
    expect(turn.summary).toBeDefined();

    const sum = turn.summary!;
    expect(doctorSummary.safeParse(sum).success).toBe(true);
    expect(sum.symptoms).toBe('আমার মাথা ব্যথা করছে');
    expect(sum.severity).toContain('তীব্র (Severe)');
    expect(sum.currentMedicines).toContain('গতকাল একটা নাপা খেয়েছিলাম কিন্তু কমেনি');
  });

  it('allows skipping optional follow-up questions', async () => {
    let turn = await processJournalTurn({
      profileId: 'prof-user-1',
      inputText: 'পেট ব্যথা করছে',
      channel: 'TEXT',
    });
    const sessionId = turn.sessionId!;

    // Skip onset
    turn = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId,
      inputText: '',
      skip: true,
      channel: 'TEXT',
    });

    expect(turn.questionIndex).toBe(2);
    expect(turn.collectedSlots?.onset).toBe('উল্লেখ করা হয়নি');
  });

  it('aborts intake immediately upon detecting red-flag emergency keywords', async () => {
    // Initial benign turn
    const turn1 = await processJournalTurn({
      profileId: 'prof-user-1',
      inputText: 'শরীর খারাপ লাগছে',
      channel: 'TEXT',
    });

    // Second turn with emergency chest pain
    const turn2 = await processJournalTurn({
      profileId: 'prof-user-1',
      sessionId: turn1.sessionId,
      inputText: 'এখন আমার বুকে তীব্র ব্যথা শুরু হয়েছে এবং দম আটকে আসছে',
      channel: 'TEXT',
    });

    expect(turn2.isRedFlag).toBe(true);
    expect(turn2.emergencyDial).toBe('999');
    expect(turn2.alertMessage).toContain('৯৯৯');
    expect(turn2.doctorSummaryReady).toBe(false);
  });

  it('renders a complete, professional HTML consultation summary document', () => {
    const summary = createDoctorSummary({
      symptoms: 'তীব্র শুকনো কাশি ও রাতে শ্বাসকষ্ট',
      onset: '৪ দিন আগে',
      duration: 'রাতের বেলা বাড়ে',
      severity: 'মাঝারি (Moderate)',
      triggers: 'ধুলোবালি ও ঠান্ডা বাতাস',
      associated: 'হালকা জ্বর ও দুর্বলতা',
      currentMedicines: ['Tab. Napa 500mg (SOS)', 'Cap. Seclo 20mg'],
      recentPrescriptions: ['Zithrox 500mg', 'Respihaler 100mcg'],
    });

    const html = renderDoctorSummaryHtml(summary, {
      profileName: 'মো: আব্দুল করিম',
      age: 62,
      gender: 'MALE',
      circleName: 'করিম পরিবার',
    });

    expect(html).toContain('উপশম (Uposhom)');
    expect(html).toContain('মো: আব্দুল করিম');
    expect(html).toContain('বয়স: 62 বছর');
    expect(html).toContain('তীব্র শুকনো কাশি ও রাতে শ্বাসকষ্ট');
    expect(html).toContain('Tab. Napa 500mg (SOS)');
    expect(html).toContain(DOCTOR_SUMMARY_DISCLAIMER_BN);
  });
});
