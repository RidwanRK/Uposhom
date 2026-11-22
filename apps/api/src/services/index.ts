import { createCaasService } from '../billing/caas.js';
import { createEntitlementService } from '../billing/entitlements.js';
import { createSubscriptionService } from '../billing/subscriptions.js';
import { dedupeKey, type CallbackSink } from '../callbacks/events.js';
import { createJobs } from '../jobs/index.js';
import { createPrivacyService } from '../privacy/erase.js';
import { createMoHandler, type MoPayload } from '../sms/mo.js';
import { createReportHandler, type ReportPayload } from '../sms/report.js';
import { SMS_SEND_QUEUE, createSmsService, type SmsSendPayload } from '../sms/send-job.js';
import {
  UNREGISTER_QUEUE,
  createUnregisterService,
  type UnregisterPayload,
} from '../subscription/unregister.js';
import type { ServiceDeps } from './deps.js';

export type { ServiceDeps } from './deps.js';

/** Callback types that have a consumer today. The others are only logged until their day comes. */
const CONSUMED = {
  'sms.mo': { queue: 'callback.sms.mo', retryLimit: 2 },
  'sms.report': { queue: 'callback.sms.report', retryLimit: 2 },
  'subscription.notify': { queue: 'callback.subscription.notify', retryLimit: 2 },
  'charging.notification': { queue: 'callback.charging.notification', retryLimit: 3 },
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
  const subscriptions = createSubscriptionService(deps, unregister);
  const entitlements = createEntitlementService(deps, subscriptions);
  const caas = createCaasService(deps);
  const privacy = createPrivacyService(deps, unregister);
  const jobs = createJobs(deps, caas, subscriptions);
  jobs.register();

  deps.queue.work<SmsSendPayload>(SMS_SEND_QUEUE, (job) => sms.handle(job));
  deps.queue.work<UnregisterPayload>(UNREGISTER_QUEUE, (job) => unregister.handle(job));
  deps.queue.work<MoPayload>(CONSUMED['sms.mo'].queue, (job) => handleMo(job.data));
  deps.queue.work<ReportPayload>(CONSUMED['sms.report'].queue, (job) => handleReport(job.data));
  deps.queue.work<Parameters<typeof caas.handleNotification>[0]>(
    CONSUMED['charging.notification'].queue,
    (job) => caas.handleNotification(job.data),
  );
  deps.queue.work<{ subscriberId: string; status: string; frequency?: string }>(
    CONSUMED['subscription.notify'].queue,
    (job) => subscriptions.handleNotification(job.data),
  );

  const sink: CallbackSink = {
    async handle(event) {
      const route = CONSUMED[event.type as keyof typeof CONSUMED];
      if (!route) return; // every callback type has a consumer
      await deps.queue.send(route.queue, event.data, {
        singletonKey: dedupeKey(event),
        retryLimit: route.retryLimit,
        retryDelaySeconds: 5,
      });
    },
  };

  return { sms, unregister, subscriptions, entitlements, caas, jobs, privacy, sink };
}

export type Services = ReturnType<typeof createServices>;
