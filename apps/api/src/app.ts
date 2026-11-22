import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApplinkClient } from '@uposhom/applink-client';
import { createOtpService } from './auth/otp-service.js';
import { registerAuthGuard } from './auth/guard.js';
import { DEFAULT_BILLING, type BillingConfig } from './billing/config.js';
import { createTokenService } from './auth/tokens.js';
import { createApplinkFromConfig } from './applink.js';
import type { CallbackSink } from './callbacks/events.js';
import type { Config } from './config/env.js';
import { defaultDomainPorts, type DomainPorts } from './ports.js';
import { createMemoryQueue } from './queue/memory.js';
import type { JobQueue } from './queue/types.js';
import { createWebhookAlerter, noopAlerter, type Alerter } from './ops/alerts.js';
import { createServices, type Services } from './services/index.js';
import { applinkCallbackRoutes } from './routes/applink-callbacks.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { caasRoutes } from './routes/caas.js';
import { optOutRoutes } from './routes/optout.js';
import { createMemoryStores } from './stores/memory.js';
import type { Stores } from './stores/types.js';

export type AppConfig = Pick<Config, 'NODE_ENV'> &
  Partial<
    Pick<
      Config,
      | 'APPLINK_CALLBACK_PATH_KEY'
      | 'APPLINK_APP_ID'
      | 'APPLINK_PASSWORD'
      | 'SMS_KEYWORD'
      | 'APPLINK_SMS_SOURCE_ADDRESS'
      | 'ALERT_WEBHOOK_URL'
      | 'JWT_SECRET'
      | 'APPLINK_OTP_REQUEST_URL'
      | 'APPLINK_OTP_VERIFY_URL'
      | 'APPLINK_SMS_SEND_URL'
      | 'APPLINK_SUBSCRIPTION_SEND_URL'
      | 'APPLINK_SUBSCRIPTION_QUERY_BASE_URL'
      | 'APPLINK_SUBSCRIPTION_CHARGING_INFO_URL'
      | 'APPLINK_CAAS_DEBIT_URL'
      | 'APPLINK_CAAS_OTP_VERIFY_URL'
    >
  >;

export interface AppDeps {
  stores?: Stores;
  applink?: ApplinkClient | undefined;
  callbackSink?: CallbackSink;
  queue?: JobQueue;
  /** Seams to the domain layer (workstream B). Defaults change no state. */
  ports?: DomainPorts;
  /** Plan prices, charge amounts and allowances. Defaults are placeholders from the plan. */
  billing?: BillingConfig;
  /** Where operational alerts go. Defaults to the webhook in ALERT_WEBHOOK_URL, else nowhere. */
  alerts?: Alerter;
  now?: () => Date;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Platform services other workstreams call, for example `app.services.sms.enqueue(...)`. */
    services: Services;
  }
}

export function buildApp(config: AppConfig, deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      // Logs hold identifiers only: never tokens, message bodies or OTPs.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true, // behind Caddy
  });

  // Liveness probe for the deploy smoke test and UptimeRobot.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Day 1 persistence is in memory. Postgres implementations replace it when B's migrations land.
  const stores = deps.stores ?? createMemoryStores();
  const alerts: Alerter =
    deps.alerts ??
    (config.ALERT_WEBHOOK_URL
      ? createWebhookAlerter({
          url: config.ALERT_WEBHOOK_URL,
          onFailure: (kind) => app.log.warn({ kind }, 'alert could not be delivered'),
        })
      : noopAlerter);
  const applink = 'applink' in deps ? deps.applink : createApplinkFromConfig(config, alerts);

  // Everything the platform does after a callback or for an outbound message runs on a queue.
  // Day 2 uses the in-memory queue; pg-boss replaces it once the Postgres stores land.
  const queue = deps.queue ?? createMemoryQueue();
  const services = createServices({
    stores,
    applink,
    queue,
    ports: deps.ports ?? defaultDomainPorts,
    billing: deps.billing ?? DEFAULT_BILLING,
    alerts,
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
    now: deps.now ?? (() => new Date()),
    smsKeyword: config.SMS_KEYWORD ?? 'UPOSHOM',
    smsSourceAddress: config.APPLINK_SMS_SOURCE_ADDRESS,
  });
  app.decorate('services', services);
  app.addHook('onReady', () => queue.start());
  app.addHook('onClose', () => queue.stop());

  // Applink callbacks live at /api/applink/<key>/..., the key being an unguessable path segment.
  const key = config.APPLINK_CALLBACK_PATH_KEY?.trim();
  void app.register(
    applinkCallbackRoutes({
      dedupe: stores.dedupe,
      sink: deps.callbackSink ?? services.sink,
      applicationId: config.APPLINK_APP_ID,
    }),
    { prefix: key ? `/api/applink/${key}` : '/api/applink' },
  );

  // Without a configured secret (development and tests only) tokens last as long as the process.
  const tokens = createTokenService(config.JWT_SECRET ?? randomBytes(32).toString('hex'));
  registerAuthGuard(app, tokens);
  const otp = createOtpService({
    stores,
    applink,
    tokens,
    log: { warn: (obj, msg) => app.log.warn(obj, msg) },
    ...(deps.now ? { now: deps.now } : {}),
  });
  void app.register(authRoutes(otp), { prefix: '/api/v1/auth' });
  void app.register(
    billingRoutes({
      users: stores.users,
      subscriptions: services.subscriptions,
      entitlements: services.entitlements,
    }),
    { prefix: '/api/v1/billing' },
  );
  void app.register(caasRoutes({ users: stores.users, caas: services.caas }), {
    prefix: '/api/v1/billing/caas',
  });
  void app.register(
    optOutRoutes({
      users: stores.users,
      unregister: services.unregister,
      subscriptions: services.subscriptions,
    }),
    { prefix: '/api/v1/account' },
  );

  return app;
}
