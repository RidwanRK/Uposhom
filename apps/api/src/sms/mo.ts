import { maskAddress } from '@uposhom/applink-client';
import type { DoseReplyCode } from '../ports.js';
import type { ServiceDeps } from '../services/deps.js';
import type { SmsService } from './send-job.js';
import type { UnregisterService } from '../subscription/unregister.js';

export type MoCommand =
  | { kind: 'STOP' }
  | { kind: 'DOSE'; code: DoseReplyCode; profileTag: string | null }
  | { kind: 'HELP' }
  | { kind: 'UNKNOWN' };

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
  if (tokens[0] === keyword.toUpperCase()) tokens = tokens.slice(1);

  const first = tokens[0];
  if (first === undefined) return { kind: 'HELP' };
  if (STOP_WORDS.has(first)) return { kind: 'STOP' };
  const code = DOSE_CODES[first];
  if (code) {
    const tag = tokens[1];
    return { kind: 'DOSE', code, profileTag: tag && /^[A-Z0-9]{1,4}$/.test(tag) ? tag : null };
  }
  if (first === 'HELP') return { kind: 'HELP' };
  return { kind: 'UNKNOWN' };
}

export interface MoPayload {
  sourceAddress: string;
  message: string;
  requestId: string;
}

/**
 * Inbound SMS. An MO SMS is only authenticated by its source address, so the only things it can
 * do are mark a dose taken, snoozed or skipped (through the domain port) and opt out. It can never
 * start a charge, subscribe anyone, or change or delete data.
 */
export function createMoHandler(deps: ServiceDeps, sms: SmsService, unregister: UnregisterService) {
  return async function handleMo(data: MoPayload): Promise<void> {
    const cmd = parseMo(data.message, deps.smsKeyword);
    const subscriber = maskAddress(data.sourceAddress);

    if (cmd.kind === 'STOP') {
      // Honoured immediately and for anyone: suppressing a number can never hurt it. Queued
      // messages stop because the send job checks suppression at send time.
      await unregister.optOut({ subscriberId: data.sourceAddress, source: 'SMS' });
      deps.log.info({ subscriber, requestId: data.requestId }, 'sms STOP honoured');
      return;
    }

    // Everything else only makes sense for someone we know. Unknown senders get no reply, so the
    // shortcode cannot be used as an SMS relay.
    const user = await deps.stores.users.findBySubscriberId(data.sourceAddress);
    if (!user) {
      deps.log.info(
        { subscriber, requestId: data.requestId },
        'mo sms from unknown subscriber ignored',
      );
      return;
    }

    if (cmd.kind === 'DOSE') {
      const { replyText } = await deps.ports.doseReply({
        subscriberId: data.sourceAddress,
        code: cmd.code,
        profileTag: cmd.profileTag,
      });
      if (replyText) {
        await sms.enqueue({
          subscriberId: data.sourceAddress,
          message: replyText,
          purpose: 'MO_REPLY',
          idempotencyKey: `mo-reply:${data.requestId}`,
        });
      }
      return;
    }

    await sms.enqueue({
      subscriberId: data.sourceAddress,
      message: `Reply ${deps.smsKeyword} 1 = taken, 2 = snooze, 3 = skip. Reply STOP to stop messages.`,
      purpose: 'MO_REPLY',
      idempotencyKey: `mo-reply:${data.requestId}`,
    });
  };
}
