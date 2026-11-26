import { maskAddress } from '@uposhom/applink-client';
import type { DoseReplyCode } from '../ports.js';
import type { ServiceDeps } from '../services/deps.js';
import { resolveSubscriber } from './identity.js';
import type { SmsService } from './send-job.js';
import type { UnregisterService } from '../subscription/unregister.js';

export type MoCommand =
  | { kind: 'STOP' }
  | { kind: 'DOSE'; code: DoseReplyCode; profileTag: string | null }
  | { kind: 'HELP' }
  /** Anything else: a free-text question for the SMS Q&A, without the keyword. */
  | { kind: 'UNKNOWN'; text: string };

const STOP_WORDS = new Set(['STOP', 'UNSUB', 'OFF']);
const DOSE_CODES: Record<string, DoseReplyCode> = { '1': 'TAKEN', '2': 'SNOOZE', '3': 'SKIP' };
const BANGLA_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

/**
 * Parse an inbound SMS. Trims, collapses whitespace, ignores case, accepts Bangla digits and an
 * optional leading keyword (`UPOSHOM 1`, `uposhom   1`, `1`). A reply may carry a short profile
 * tag after the code (`UPOSHOM 1 A`) for numbers that serve several profiles.
 */
export function parseMo(message: string, keyword: string): MoCommand {
  const normalised = message
    .replace(/[০-৯]/g, (d) => BANGLA_DIGITS[d] ?? d)
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  let tokens = normalised === '' ? [] : normalised.split(' ');
  // The same words in their original case, for a free-text question.
  let original = message.trim().replace(/\s+/g, ' ').split(' ');
  if (tokens[0] === keyword.toUpperCase()) {
    tokens = tokens.slice(1);
    original = original.slice(1);
  }

  const first = tokens[0];
  if (first === undefined) return { kind: 'HELP' };
  if (STOP_WORDS.has(first)) return { kind: 'STOP' };
  const code = DOSE_CODES[first];
  if (code) {
    const tag = tokens[1];
    return { kind: 'DOSE', code, profileTag: tag && /^[A-Z0-9]{1,4}$/.test(tag) ? tag : null };
  }
  if (first === 'HELP') return { kind: 'HELP' };
  return { kind: 'UNKNOWN', text: original.join(' ') };
}

export interface MoPayload {
  sourceAddress: string;
  message: string;
  requestId: string;
}

/** The usage line, with the published support contact (Master Plan section 8: the SMS help reply). */
export function helpText(keyword: string, support?: { email?: string; phone?: string }): string {
  const contact = [support?.email, support?.phone].filter(Boolean).join(', ');
  return (
    `Reply ${keyword} 1 = taken, 2 = snooze, 3 = skip, or ask about your medicines. ` +
    `Reply STOP to stop messages.${contact ? ` Help: ${contact}` : ''}`
  );
}

/**
 * Inbound SMS. An MO SMS is only authenticated by its source address, so the only things it can
 * do are mark a dose taken, snoozed or skipped (through the domain port), ask a read-only question
 * and opt out. It can never start a charge, subscribe anyone, or change or delete data.
 */
export function createMoHandler(deps: ServiceDeps, sms: SmsService, unregister: UnregisterService) {
  return async function handleMo(data: MoPayload): Promise<void> {
    const cmd = parseMo(data.message, deps.smsKeyword);
    const subscriber = maskAddress(data.sourceAddress);
    // The id we stored for this person (an account, or a dependent's own phone), whichever form
    // the callback used for it.
    const {
      id: subscriberId,
      user,
      isProfile,
    } = await resolveSubscriber(deps.stores, data.sourceAddress, deps.ports);

    if (cmd.kind === 'STOP') {
      // Honoured immediately and for anyone: suppressing a number can never hurt it. Queued
      // messages stop because the send job checks suppression at send time.
      await unregister.optOut({ subscriberId, source: 'SMS' });
      if (isProfile) await deps.ports.onProfileOptOut({ subscriberId, source: 'SMS' });
      deps.log.info({ subscriber, requestId: data.requestId }, 'sms STOP honoured');
      return;
    }

    // Everything else only makes sense for someone we know. Unknown senders get no reply, so the
    // shortcode cannot be used as an SMS relay.
    if (!user && !isProfile) {
      deps.log.info(
        { subscriber, requestId: data.requestId },
        'mo sms from unknown subscriber ignored',
      );
      return;
    }

    if (cmd.kind === 'DOSE') {
      const { replyText } = await deps.ports.doseReply({
        subscriberId,
        code: cmd.code,
        profileTag: cmd.profileTag,
      });
      if (replyText) {
        await sms.enqueue({
          subscriberId,
          message: replyText,
          purpose: 'MO_REPLY',
          idempotencyKey: `mo-reply:${data.requestId}`,
        });
      }
      return;
    }

    // Free text: SMS Q&A through the AI router (read-only, the person's own doses). Never for a
    // reply code: those stay deterministic and never call a model.
    let reply: string | null = null;
    if (cmd.kind === 'UNKNOWN' && cmd.text !== '') {
      try {
        const answer = await deps.ports.smsQuestion({ subscriberId, text: cmd.text });
        if (answer.silent) return;
        reply = answer.replyText;
      } catch (err) {
        deps.log.warn(
          {
            subscriber,
            requestId: data.requestId,
            err: err instanceof Error ? err.name : 'unknown',
          },
          'sms question failed: sending the usage line',
        );
      }
    }

    await sms.enqueue({
      subscriberId,
      message: reply ?? helpText(deps.smsKeyword, deps.support),
      purpose: 'MO_REPLY',
      idempotencyKey: `mo-reply:${data.requestId}`,
    });
  };
}
