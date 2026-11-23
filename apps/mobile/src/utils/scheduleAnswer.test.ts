import { describe, expect, it } from 'vitest';
import { answerScheduleQuestion } from './scheduleAnswer';

const doses = [
  {
    dueAt: '2026-11-23T08:30:00+06:00',
    medicine: 'Napa Extra',
    medicineBn: 'নাপা এক্সট্রা',
    instructions: 'খাবার পর',
    status: 'TAKEN',
  },
  {
    dueAt: '2026-11-23T13:30:00+06:00',
    medicine: 'Amlodipine 5',
    status: 'SCHEDULED',
    instructions: 'খাবার পর',
  },
  {
    dueAt: '2026-11-23T20:30:00+06:00',
    medicine: 'Napa Extra',
    medicineBn: 'নাপা এক্সট্রা',
    status: 'SCHEDULED',
  },
];
const now = new Date('2026-11-23T12:00:00+06:00').getTime();

describe('read-only schedule answers', () => {
  it('names the next open dose', () => {
    expect(answerScheduleQuestion(doses, 'পরের ওষুধ কখন?', now)).toBe(
      'পরের ওষুধ দুপুর ০১:৩০। Amlodipine 5 খাবার পর।',
    );
  });

  it('lists what is left today', () => {
    expect(answerScheduleQuestion(doses, 'আজ কোন ওষুধ বাকি?', now)).toBe(
      'আজ আর ২টি ওষুধ বাকি আছে। দুপুর ০১:৩০ Amlodipine 5, রাত ০৮:৩০ নাপা এক্সট্রা।',
    );
  });

  it('says so when nothing is left', () => {
    const none = doses.map((d) => ({ ...d, status: 'TAKEN' }));
    expect(answerScheduleQuestion(none, 'আজ কোন ওষুধ বাকি?', now)).toBe('আজ আর কোনো ওষুধ বাকি নেই।');
    expect(answerScheduleQuestion(none, 'পরের ওষুধ কখন?', now)).toBe('আজ আর কোনো ওষুধ বাকি নেই।');
  });
});
