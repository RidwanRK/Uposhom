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
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createDb } from '@uposhom/db';
import type { DomainPorts } from '../ports.js';
import type { JobQueue } from '../queue/types.js';
import { createPhoneCrypto } from '../security/phone-crypto.js';
import type { Services } from '../services/index.js';
import type { Stores } from '../stores/types.js';
import { domainRoutes } from '../routes/domain.js';
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
import { createDomainService, type DomainService } from './service.js';
import type { DomainStore } from './types.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Workstream B's domain service: circles, prescriptions, doses. */
    domain: DomainService;
    /** The reminder and escalation ladder (tests call tick() directly). */
    ladder: LadderRunner;
  }
}

/** What the caller may choose. Everything defaults to in-memory, for development and tests. */
export interface DomainOptions {
  store?: DomainStore;
  /**
   * Keyed hash for finding a person by number without storing it. postgresDomain() uses A's
   * PhoneCrypto.lookupHash; the default, for development and tests, is a plain SHA-256.
   */
  phoneKey?: (msisdn: string) => string;
  /** Where caregiver pushes go. Defaults to Expo, or nowhere under NODE_ENV=test. */
  push?: PushSender;
}

/** The Postgres store and the real phone hash, for index.ts when STORE_DRIVER=postgres. */
export function postgresDomain(pool: Pool, phoneEncKey: string): DomainOptions {
  const crypto = createPhoneCrypto(phoneEncKey);
  return {
    store: createPostgresDomainStore(createDb(pool)),
    phoneKey: (msisdn) => crypto.lookupHash(msisdn),
  };
}

export function createDomainHooks() {
  // A's services need the ports before the domain service exists, and the domain service needs
  // A's services: the ports call through a reference that attach() fills.
  const ref: { domain?: DomainService; ladder?: LadderRunner } = {};
  const ports: DomainPorts = {
    doseReply: (input) => ref.domain!.smsReply(input),
    eraseDomainData: (userId) => ref.domain!.eraseUser(userId),
    // A bounced reminder for a critical dose brings the caregiver alert forward.
    onSmsDeliveryFailure: (input) => ref.ladder!.onDeliveryFailure(input),
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
        return user ? { id: user.id, msisdn: user.msisdn } : null;
      },
      findUserIdByMsisdn: async (msisdn) => (await stores.users.findByMsisdn(msisdn))?.id ?? null,
      phoneKey:
        ctx.options?.phoneKey ??
        ((msisdn) => createHash('sha256').update(`uposhom:${msisdn}`).digest('hex')),
    });

    // The reminder and escalation ladder, every minute, on the same queue as A's jobs.
    const ladder = createLadderRunner({
      store,
      now,
      smsKeyword: ctx.smsKeyword,
      sendSms: (msg) => services.sms.enqueue(msg),
      useSms: (userId) => services.entitlements.useSms(userId),
      isPremium,
      subscriberOf: async (userId) => (await stores.users.findById(userId))?.subscriberId ?? null,
      findUserIdBySubscriber,
      push: async (msg) => {
        await queue.send(PUSH_QUEUE, msg, {
          singletonKey: msg.idempotencyKey,
          retryLimit: PUSH_RETRY_LIMIT,
          retryDelaySeconds: 10,
        });
      },
      log,
    });
    queue.work(LADDER_JOB.queue, async () => {
      await ladder.tick();
    });
    void queue.schedule(LADDER_JOB.queue, LADDER_JOB.cron, { tz: 'Asia/Dhaka' });

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
    app.decorate('domain', domain);
    app.decorate('ladder', ladder);
    void app.register(domainRoutes(domain), { prefix: '/api/v1' });
  }

  return { ports, attach };
}
