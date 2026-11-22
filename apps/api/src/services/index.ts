import { dedupeKey, type CallbackSink } from '../callbacks/events.js';
import { createMoHandler, type MoPayload } from '../sms/mo.js';
import { createReportHandler, type ReportPayload } from '../sms/report.js';
import { SMS_SEND_QUEUE, createSmsService, type SmsSendPayload } from '../sms/send-job.js';
import {
  UNREGISTER_QUEUE,
  createUnregisterService,
  type UnregisterPayload,
} from '../subscription/unregister.js';
import { createUssdHandler, type UssdPayload } from '../ussd/menu.js';
import type { ServiceDeps } from './deps.js';

export type { ServiceDeps } from './deps.js';

/** Callback types that have a consumer today. The others are only logged until their day comes. */
const CONSUMED = {
  'sms.mo': { queue: 'callback.sms.mo', retryLimit: 2 },
  'sms.report': { queue: 'callback.sms.report', retryLimit: 2 },
  // A USSD screen that arrives after the session has timed out is useless: never retried.
  'ussd.mo': { queue: 'callback.ussd.mo', retryLimit: 0 },
} as const;

/**
 * Wires the consumers onto the queue and returns the callback sink that feeds it. Nothing in here
 * knows about Fastify, so the worker app can call it unchanged once the stores are Postgres.
 */
export function createServices(deps: ServiceDeps) {
  const sms = createSmsService(deps);
  const unregister = createUnregisterService(deps);
  const handleMo = createMoHandler(deps, sms, unregister);
  const handleReport = createReportHandler(deps);
  const handleUssd = createUssdHandler(deps, unregister);

  deps.queue.work<SmsSendPayload>(SMS_SEND_QUEUE, (job) => sms.handle(job));
  deps.queue.work<UnregisterPayload>(UNREGISTER_QUEUE, (job) => unregister.handle(job));
  deps.queue.work<MoPayload>(CONSUMED['sms.mo'].queue, (job) => handleMo(job.data));
  deps.queue.work<ReportPayload>(CONSUMED['sms.report'].queue, (job) => handleReport(job.data));
  deps.queue.work<UssdPayload>(CONSUMED['ussd.mo'].queue, (job) => handleUssd(job.data));

  const sink: CallbackSink = {
    async handle(event) {
      const route = CONSUMED[event.type as keyof typeof CONSUMED];
      if (!route) return; // subscription.notify and charging.notification land on Days 4 and 5
      await deps.queue.send(route.queue, event.data, {
        singletonKey: dedupeKey(event),
        retryLimit: route.retryLimit,
        retryDelaySeconds: 5,
      });
    },
  };

  return { sms, unregister, sink };
}

export type Services = ReturnType<typeof createServices>;
