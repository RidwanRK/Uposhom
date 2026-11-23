import { formatTimeBn } from './dates';
import { toBn } from './bangla';

export interface AnswerDose {
  dueAt: string;
  medicine: string;
  medicineBn?: string | undefined;
  instructions?: string | undefined;
  status: string;
}

const OPEN = new Set(['SCHEDULED', 'SNOOZED']);

/**
 * Read-only answer to "পরের ওষুধ কখন?" / "আজ কোন ওষুধ বাকি?" from the dose events the server already
 * returned. Used when the triage endpoint is unavailable. It never marks a dose or changes a schedule,
 * and it computes no dose of its own: it only reads and phrases what the server scheduled.
 */
export function answerScheduleQuestion(
  doses: AnswerDose[],
  text: string,
  now: number = Date.now(),
): string {
  const pending = doses
    .filter((d) => OPEN.has(d.status))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const name = (d: AnswerDose) => d.medicineBn ?? d.medicine;

  if (/বাকি/.test(text)) {
    if (pending.length === 0) return 'আজ আর কোনো ওষুধ বাকি নেই।';
    return `আজ আর ${toBn(pending.length)}টি ওষুধ বাকি আছে। ${pending.map((d) => `${formatTimeBn(d.dueAt)} ${name(d)}`).join(', ')}।`;
  }

  // "Next": the earliest still-open dose that is due now or later (a dose up to 45 minutes late still counts).
  const next =
    pending.find((d) => new Date(d.dueAt).getTime() >= now - 45 * 60 * 1000) ?? pending[0];
  if (!next) return 'আজ আর কোনো ওষুধ বাকি নেই।';
  return `পরের ওষুধ ${formatTimeBn(next.dueAt)}। ${name(next)}${next.instructions ? ` ${next.instructions}` : ''}।`;
}
