import type { FastifyInstance } from 'fastify';
import type { ZodType } from 'zod';
import { maskAddress } from '@uposhom/applink-client';
import {
  chargingNotification,
  dedupeKey,
  smsReceive,
  smsReport,
  subscriptionNotify,
  type CallbackEvent,
  type CallbackKind,
  type CallbackSink,
} from '../callbacks/events.js';
import type { DedupeStore } from '../stores/types.js';

const ACK = { statusCode: 'S1000', statusDetail: 'Success' } as const;

export interface CallbackDeps {
  dedupe: DedupeStore;
  sink: CallbackSink;
  /** Our applicationId. Payloads that carry a different one belong to someone else and are dropped. */
  applicationId?: string | undefined;
}

const ROUTES: ReadonlyArray<{ path: string; type: CallbackKind; schema: ZodType }> = [
  { path: '/sms/receive', type: 'sms.mo', schema: smsReceive },
  { path: '/sms/report', type: 'sms.report', schema: smsReport },
  { path: '/subscription/notify', type: 'subscription.notify', schema: subscriptionNotify },
  {
    path: '/caas/charging-notification',
    type: 'charging.notification',
    schema: chargingNotification,
  },
];

/** Log-safe identifiers only: never message bodies, OTPs, passwords or unmasked numbers. */
function logFields(event: CallbackEvent): Record<string, string | undefined> {
  const d = event.data as Record<string, unknown>;
  const s = (k: string): string | undefined =>
    typeof d[k] === 'string' ? (d[k] as string) : undefined;
  const addr = s('sourceAddress') ?? s('destinationAddress') ?? s('subscriberId');
  return {
    type: event.type,
    requestId: s('requestId'),
    sessionId: s('sessionId'),
    externalTrxId: s('externalTrxId'),
    internalTrxId: s('internalTrxId'),
    statusCode: s('statusCode'),
    subscriber: addr ? maskAddress(addr) : undefined,
  };
}

/**
 * The five Applink webhooks. Contract: always answer 200 S1000, acknowledge first and work second,
 * never trust the body, deduplicate redeliveries. Malformed, foreign or duplicate payloads are
 * acknowledged and discarded, because a 4xx or 5xx only makes the platform retry.
 */
export function applinkCallbackRoutes(deps: CallbackDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    // Malformed or empty JSON must not become a 400: parse leniently and let the handler discard it.
    const lenient = (
      _req: unknown,
      body: string | Buffer,
      done: (err: Error | null, value?: unknown) => void,
    ): void => {
      try {
        done(null, JSON.parse(body.toString()));
      } catch {
        done(null, null);
      }
    };
    app.addContentTypeParser('application/json', { parseAs: 'string' }, lenient);
    app.addContentTypeParser('*', { parseAs: 'string' }, lenient);

    for (const route of ROUTES) {
      app.post(route.path, async (req) => {
        const parsed = route.schema.safeParse(req.body);
        if (!parsed.success) {
          req.log.warn({ type: route.type }, 'callback payload rejected');
          return ACK;
        }
        // The subscriber notification carries our API key back to us: drop it before anything
        // else can see it.
        const data = { ...(parsed.data as Record<string, unknown>) };
        delete data['password'];
        const event = { type: route.type, data } as CallbackEvent;

        const foreignId = (data['applicationId'] as string | undefined) ?? undefined;
        if (deps.applicationId && foreignId && foreignId !== deps.applicationId) {
          req.log.warn({ type: route.type }, 'callback for another application dropped');
          return ACK;
        }

        // Acknowledge first, work second.
        setImmediate(() => {
          void (async () => {
            try {
              if (!(await deps.dedupe.firstSeen(dedupeKey(event), new Date()))) {
                req.log.info({ ...logFields(event), duplicate: true }, 'callback duplicate');
                return;
              }
              req.log.info(logFields(event), 'callback received');
              await deps.sink.handle(event);
            } catch (err) {
              req.log.error(
                { ...logFields(event), err: (err as Error).name },
                'callback handling failed',
              );
            }
          })();
        });
        return ACK;
      });
    }
  };
}
