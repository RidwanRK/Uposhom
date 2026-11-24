/**
 * Workstream B's whole hook into the API, in one place, so A's files only need to call it:
 *
 *   app.ts:   const domainHooks = createDomainHooks();          before createServices
 *             ports: deps.ports ?? domainHooks.ports             in createServices
 *             domainHooks.attach(app, { ... });                  after app.decorate('services')
 *   index.ts: domain: postgresDomain(pool, phoneEncKey)          when the Postgres stores are on
 *
 * attach() builds the domain store, service, reminder ladder and push sender, registers B's
 * routes under /api/v1 and B's queue jobs, and fills A's domain ports.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createDb } from '@uposhom/db';
import { RETENTION } from '../ops/retention.js';
import type { DomainPorts } from '../ports.js';
import type { JobQueue } from '../queue/types.js';
import { createPhoneCrypto } from '../security/phone-crypto.js';
import type { Services } from '../services/index.js';
import type { Stores } from '../stores/types.js';
import { domainRoutes } from '../routes/domain.js';
import { featureRoutes } from '../routes/features.js';
import { createFeatureService, type FeatureService } from './features.js';
import { CARE_JOBS, createCareJobs, type CareJobs } from './care-jobs.js';
import { LADDER_JOB, createLadderRunner, type LadderRunner } from './escalation.js';
import { createMemoryDomainStore } from './memory.js';
import { createPostgresDomainStore } from './postgres.js';
import {
  PUSH_QUEUE,
  PUSH_RETRY_LIMIT,
  createExpoPushSender,
  createPushHandler,
  noopPushSender,
  type PushJobPayload,
  type PushSender,
} from './push.js';
import { createDomainService, type DomainService, type DomainServiceDeps } from './service.js';
import type { DomainStore } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Workstream B's domain service: circles, prescriptions, doses. */
    domain: DomainService;
    /** The reminder and escalation ladder (tests call tick() directly). */
    ladder: LadderRunner;
    /** Refill, follow-up and digest jobs (tests call them directly). */
    careJobs: CareJobs;
    /** Scans, reports, journal, voice, insights, drugs, pharmacies, settings. */
    features: FeatureService;
    /** Nightly retention for agent_traces and audit_log (tests call it directly). */
    purgeDomainData: () => Promise<{ agentTraces: number; auditLog: number }>;
  }
}

/** Free-text SMS questions answered per number per day. */
export const SMS_QUESTIONS_PER_DAY = 10;

/** Runs after A's platform purge (03:30). */
export const DOMAIN_RETENTION_JOB = { queue: 'job.domain.retention', cron: '45 3 * * *' } as const;

/** What the caller may choose. Everything defaults to in-memory, for development and tests. */
export interface DomainOptions {
  store?: DomainStore;
  /**
   * Keyed hash for finding a person by number without storing it. postgresDomain() uses A's
   * PhoneCrypto.lookupHash; the default, for development and tests, is a plain SHA-256.
   */
  phoneKey?: (msisdn: string) => string;
  /**
   * Encrypts a dependent's number for profiles.phone_enc. postgresDomain() uses A's PhoneCrypto;
   * the default, for development and tests, uses a key made up at start.
   */
  encryptPhone?: (msisdn: string) => string;
  /** Where caregiver pushes go. Defaults to Expo, or nowhere under NODE_ENV=test. */
  push?: PushSender;
}

/** The Postgres store and the real phone hash, for index.ts when STORE_DRIVER=postgres. */
export function postgresDomain(pool: Pool, phoneEncKey: string): DomainOptions {
  const crypto = createPhoneCrypto(phoneEncKey);
  return {
    store: createPostgresDomainStore(createDb(pool)),
    phoneKey: (msisdn) => crypto.lookupHash(msisdn),
    encryptPhone: (msisdn) => crypto.encrypt(msisdn),
  };
}

export function createDomainHooks() {
  // A's services need the ports before the domain service exists, and the domain service needs
  // A's services: the ports call through a reference that attach() fills.
  const ref: {
    domain?: DomainService;
    ladder?: LadderRunner;
    store?: DomainStore;
    smsQuestion?: DomainPorts['smsQuestion'];
  } = {};
  const ports: DomainPorts = {
    doseReply: (input) => ref.domain!.smsReply(input),
    eraseDomainData: (userId) => ref.domain!.eraseUser(userId),
    // A bounced reminder for a critical dose brings the caregiver alert forward.
    onSmsDeliveryFailure: (input) => ref.ladder!.onDeliveryFailure(input),
    // A dependent's own phone (Family Link) is a known sender too.
    isProfileSubscriber: async (subscriberId) =>
      (await ref.store!.profiles.findBySubscriberId(subscriberId)).length > 0,
    smsQuestion: (input) => ref.smsQuestion!(input),
    onProfileOptOut: (input) => ref.domain!.recordProfileOptOut(input),
  };

  function attach(
    app: FastifyInstance,
    ctx: {
      stores: Stores;
      services: Services;
      queue: JobQueue;
      now?: (() => Date) | undefined;
      nodeEnv: string;
      smsKeyword: string;
      options?: DomainOptions | undefined;
      /** A's OTP service, for Family Link. */
      familyLink?: DomainServiceDeps['familyLink'];
    },
  ): void {
    const { stores, services, queue } = ctx;
    const now = ctx.now ?? (() => new Date());
    const store = ctx.options?.store ?? createMemoryDomainStore();
    const log = {
      info: (obj: object, msg: string) => app.log.info(obj, msg),
      warn: (obj: object, msg: string) => app.log.warn(obj, msg),
    };
    const isPremium = async (userId: string) => {
      const user = await stores.users.findById(userId);
      return user ? services.subscriptions.isPremium(user) : false;
    };
    const findUserIdBySubscriber = async (subscriberId: string) =>
      (await stores.users.findBySubscriberId(subscriberId))?.id ?? null;

    const domain = createDomainService({
      store,
      now,
      isPremium,
      findUserIdBySubscriber,
      findUser: async (userId) => {
        const user = await stores.users.findById(userId);
        return user ? { id: user.id, msisdn: user.msisdn, isAdmin: user.isAdmin } : null;
      },
      findUserIdByMsisdn: async (msisdn) => (await stores.users.findByMsisdn(msisdn))?.id ?? null,
      phoneKey:
        ctx.options?.phoneKey ??
        ((msisdn) => createHash('sha256').update(`uposhom:${msisdn}`).digest('hex')),
      encryptPhone:
        ctx.options?.encryptPhone ??
        ((msisdn) => createPhoneCrypto(randomBytes(32).toString('hex')).encrypt(msisdn)),
      ...(ctx.familyLink ? { familyLink: ctx.familyLink } : {}),
    });

    // The reminder and escalation ladder, every minute, on the same queue as A's jobs.
    const subscriberOf = async (userId: string) =>
      (await stores.users.findById(userId))?.subscriberId ?? null;
    const push = async (msg: PushJobPayload) => {
      await queue.send(PUSH_QUEUE, msg, {
        singletonKey: msg.idempotencyKey,
        retryLimit: PUSH_RETRY_LIMIT,
        retryDelaySeconds: 10,
      });
    };
    const ladder = createLadderRunner({
      store,
      now,
      smsKeyword: ctx.smsKeyword,
      sendSms: (msg) => services.sms.enqueue(msg),
      useSms: (userId) => services.entitlements.useSms(userId),
      isPremium,
      subscriberOf,
      findUserIdBySubscriber,
      push,
      log,
    });
    queue.work(LADDER_JOB.queue, async () => {
      await ladder.tick();
    });
    void queue.schedule(LADDER_JOB.queue, LADDER_JOB.cron, { tz: 'Asia/Dhaka' });

    // Refill and follow-up reminders and the weekly caregiver digest.
    const care = createCareJobs({
      store,
      now,
      sendSms: (msg) => services.sms.enqueue(msg),
      useSms: (userId) => services.entitlements.useSms(userId),
      subscriberOf,
      push,
      log,
    });
    for (const [def, run] of [
      [CARE_JOBS.refills, care.refills],
      [CARE_JOBS.appointments, care.appointments],
      [CARE_JOBS.digest, care.digest],
    ] as const) {
      queue.work(def.queue, async () => {
        await run();
      });
      void queue.schedule(def.queue, def.cron, { tz: 'Asia/Dhaka' });
    }

    // Retention for B's tables (Master Plan section 8): agent traces 30 days, audit log 1 year.
    // A's nightly purge covers the platform tables; this one runs right after it.
    queue.work(DOMAIN_RETENTION_JOB.queue, async () => {
      await purgeDomainData();
    });
    void queue.schedule(DOMAIN_RETENTION_JOB.queue, DOMAIN_RETENTION_JOB.cron, {
      tz: 'Asia/Dhaka',
    });
    async function purgeDomainData() {
      const t = now().getTime();
      const counts = {
        agentTraces: await store.traces.purgeBefore(new Date(t - RETENTION.agentTracesMs)),
        auditLog: await store.audit.purgeBefore(new Date(t - RETENTION.auditLogMs)),
      };
      app.log.info(counts, 'domain retention purge');
      return counts;
    }

    // Caregiver pushes go out from their own queue, so a slow Expo never holds up the ladder.
    const sender =
      ctx.options?.push ?? (ctx.nodeEnv === 'test' ? noopPushSender : createExpoPushSender({}));
    queue.work<PushJobPayload>(
      PUSH_QUEUE,
      createPushHandler({
        listTokens: async (userId) =>
          (await store.devices.listForUser(userId)).map((d) => d.expoToken),
        removeToken: (token) => store.devices.removeToken(token),
        sender,
        log,
      }),
    );

    ref.domain = domain;
    ref.ladder = ladder;
    ref.store = store;
    app.decorate('domain', domain);
    app.decorate('ladder', ladder);
    app.decorate('careJobs', care);
    app.decorate('purgeDomainData', purgeDomainData);
    void app.register(domainRoutes(domain), { prefix: '/api/v1' });

    // The app's remaining endpoints: scans, reports, journal, voice, insights, drugs, pharmacies,
    // settings. C's AI does the thinking; B's store keeps the results; A's entitlements gate them.
    const features = createFeatureService({
      store,
      domain,
      now,
      useScan: (userId) => services.entitlements.useScan(userId),
      useFeature: (userId, feature) => services.entitlements.useFeature(userId, feature),
      isPremium,
      accountType: async (userId) => (await stores.users.findById(userId))?.accountType ?? null,
      findUserIdBySubscriber,
      useSms: (userId) => services.entitlements.useSms(userId),
    });
    // SMS Q&A calls a model and costs an SMS: a cap per number per day keeps a chatty (or abusive)
    // sender from running up either bill. Over the cap, nothing is sent back.
    ref.smsQuestion = async (input) => {
      const hit = await stores.rateLimit.hit(
        `smsqa:${input.subscriberId}`,
        SMS_QUESTIONS_PER_DAY,
        24 * 60 * 60 * 1000,
        now(),
      );
      if (!hit.allowed) return { replyText: null, silent: true };
      return features.smsQuestion(input);
    };
    app.decorate('features', features);
    void app.register(featureRoutes(features), { prefix: '/api/v1' });
  }

  return { ports, attach };
}
