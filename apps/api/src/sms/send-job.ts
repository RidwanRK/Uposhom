import {
  ApplinkError,
  ApplinkNotConfiguredError,
  ApplinkTransportError,
  maskAddress,
} from '@uposhom/applink-client';
import type { Job } from '../queue/types.js';
import type { ServiceDeps } from '../services/deps.js';
import { smsSegments } from './format.js';

export const SMS_SEND_QUEUE = 'sms.send';
export const SMS_RETRY_LIMIT = 3;

export interface SmsSendPayload {
  /** The opaque subscriber id Applink gave us, never the number the user typed. */
  subscriberId: string;
  message: string;
  /** What the message is for: REMINDER, CAREGIVER_ALERT, MO_REPLY... Stored in sms_log. */
  purpose: string;
  /** Stable key for this logical message: a re-enqueue or a queue redelivery never sends twice. */
  idempotencyKey: string;
  /** Ask Applink for a delivery report. Only worth it for messages whose report we act on. */
  deliveryReport?: boolean;
  /** A human flagged the dose as critical: a failed delivery brings the caregiver alert forward. */
  critical?: boolean;
}

/** Applink answered E1342 (blacklisted) or similar: never message this number again. */
const BLOCKING_CODES = new Set(['E1342']);

/**
 * Every outbound SMS goes through here. The rules (Master Plan section 8):
 *  - suppressed numbers (STOP, dead, blocked) are skipped at send time, so a STOP also cancels
 *    everything still queued for that number;
 *  - an sms_log row is written before Applink is called, and a timeout leaves it UNKNOWN rather than
 *    retrying, because a timeout does not mean the message was not sent;
 *  - only an Applink answer that says "rejected, transient" (E1318, E1319, E1341, E1601, E1602,
 *    E1603) is retried, with backoff, at most three times;
 *  - the per-recipient statusCode is read, not only the top level;
 *  - message bodies are never logged or stored.
 */
export function createSmsService(deps: ServiceDeps) {
  const { stores, applink, queue, log, now } = deps;
  let lastSendAt = 0;

  /** Keeps sends at least `smsMinIntervalMs` apart. The queue runs one SMS job at a time. */
  async function throttle(): Promise<void> {
    const gap = deps.smsMinIntervalMs;
    if (!gap) return;
    const wait = lastSendAt + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSendAt = Date.now();
  }

  async function enqueue(payload: SmsSendPayload): Promise<void> {
    const seg = smsSegments(payload.message);
    if (seg.parts > 1) {
      log.info(
        { purpose: payload.purpose, parts: seg.parts, encoding: seg.encoding },
        'sms spans several parts',
      );
    }
    await queue.send(SMS_SEND_QUEUE, payload, {
      singletonKey: payload.idempotencyKey,
      retryLimit: SMS_RETRY_LIMIT,
      retryDelaySeconds: 5,
    });
  }

  async function handle(job: Job<SmsSendPayload>): Promise<void> {
    const p = job.data;
    const t = now();
    const subscriber = maskAddress(p.subscriberId);
    const base = {
      idempotencyKey: p.idempotencyKey,
      subscriberId: p.subscriberId,
      purpose: p.purpose,
      critical: p.critical ?? false,
    };

    const { record, created } = await stores.smsLog.create(base, t);
    // Anything but PENDING has been decided already (sent, failed, unknown or skipped): a
    // redelivered or re-enqueued job must not send a second message.
    if (!created && record.status !== 'PENDING') return;

    const suppression = await stores.optOuts.suppressionFor(p.subscriberId);
    if (suppression) {
      await stores.smsLog.update(record.id, { status: 'SKIPPED' }, t);
      log.info(
        { subscriber, purpose: p.purpose, reason: suppression },
        'sms skipped: number suppressed',
      );
      return;
    }

    if (!applink) {
      await stores.smsLog.update(
        record.id,
        { status: 'FAILED', applinkStatusCode: 'NOT_CONFIGURED' },
        t,
      );
      log.warn({ purpose: p.purpose }, 'sms not sent: Applink is not configured');
      return;
    }

    const failWith = async (code: string): Promise<void> => {
      await stores.smsLog.update(record.id, { status: 'FAILED', applinkStatusCode: code }, now());
      if (BLOCKING_CODES.has(code)) {
        await stores.optOuts.suppress(
          { subscriberId: p.subscriberId, reason: 'BLOCKED', source: 'SYSTEM' },
          now(),
        );
      }
    };

    // Retry only while attempts remain; on the last one record the failure before giving up.
    const retryOrFail = async (code: string): Promise<void> => {
      if (job.retryCount >= SMS_RETRY_LIMIT) {
        await failWith(code);
        log.error({ subscriber, purpose: p.purpose, statusCode: code }, 'sms failed after retries');
        // E1319 is the per-day ceiling: retrying will not clear it today. A human should know.
        if (code === 'E1319') deps.alerts.alert('applink-daily-sms-limit', { statusCode: code });
        return;
      }
      throw new ApplinkError(code, '', 'sms-send'); // the queue retries with backoff
    };

    let response;
    try {
      await throttle();
      response = await applink.sendSms(p.subscriberId, p.message, {
        ...(p.deliveryReport ? { deliveryStatusRequest: '1' as const } : {}),
        ...(deps.smsSourceAddress ? { sourceAddress: deps.smsSourceAddress } : {}),
      });
    } catch (err) {
      if (err instanceof ApplinkError) {
        if (err.retryable) return retryOrFail(err.statusCode);
        await failWith(err.statusCode);
        const level = err.isConfiguration ? 'error' : 'warn';
        log[level](
          {
            subscriber,
            purpose: p.purpose,
            statusCode: err.statusCode,
            configuration: err.isConfiguration,
          },
          'sms rejected by Applink',
        );
        return;
      }
      if (err instanceof ApplinkTransportError) {
        // It may have gone out. Never re-send blindly: reconcile from the delivery report.
        await stores.smsLog.update(record.id, { status: 'UNKNOWN' }, now());
        log.warn({ subscriber, purpose: p.purpose }, 'sms outcome unknown after transport failure');
        return;
      }
      if (err instanceof ApplinkNotConfiguredError) {
        await failWith('NOT_CONFIGURED');
        log.error({ purpose: p.purpose }, 'sms endpoint not enabled');
        return;
      }
      await failWith('INVALID_REQUEST'); // for example an empty subscriber address
      log.error({ purpose: p.purpose }, 'sms could not be built');
      return;
    }

    // S1000 at the top level only means the request was processed: read the recipient's own result.
    const dest = response.destinationResponses?.[0];
    const code = dest?.statusCode ?? response.statusCode;
    if (code !== 'S1000') {
      if (new ApplinkError(code, '', 'sms-send').retryable) return retryOrFail(code);
      await failWith(code);
      log.warn(
        { subscriber, purpose: p.purpose, statusCode: code },
        'sms rejected for the recipient',
      );
      return;
    }

    const requestId = response.requestId ?? dest?.messageId ?? null;
    await stores.smsLog.update(
      record.id,
      { status: 'SUBMITTED', requestId, applinkStatusCode: code },
      now(),
    );
    log.info({ subscriber, purpose: p.purpose, requestId }, 'sms submitted');
  }

  return { enqueue, handle };
}

export type SmsService = ReturnType<typeof createSmsService>;
