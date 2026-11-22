import { vi } from 'vitest';
import { ApplinkError, type ApplinkClient } from '@uposhom/applink-client';
import { buildApp } from '../src/app.js';
import { defaultDomainPorts, type DomainPorts } from '../src/ports.js';
import { createMemoryQueue, type MemoryQueue } from '../src/queue/memory.js';
import type { JobQueue } from '../src/queue/types.js';
import { createMemoryStores } from '../src/stores/memory.js';

export const SUB = 'tel:8801959979376';
export const OTHER = 'tel:8801711111111';

export const ok = <T extends object>(extra: T) => ({
  statusCode: 'S1000',
  statusDetail: 'Success',
  ...extra,
});

/** A stand-in Applink client whose calls are spies. Override any method per test. */
export function fakeApplink(over: Record<string, unknown> = {}) {
  const fake = {
    sendSms: vi.fn(async () =>
      ok({ requestId: 'req-1', destinationResponses: [{ statusCode: 'S1000', address: SUB }] }),
    ),
    unregister: vi.fn(async () => ok({ subscriptionStatus: 'UNREGISTERED' })),
    // Overrides are spies too, so tests can count calls.
    ...Object.fromEntries(
      Object.entries(over).map(([k, fn]) => [k, vi.fn(fn as (...a: never[]) => unknown)]),
    ),
  };
  return fake as typeof fake & ApplinkClient;
}

export const applinkError = (code: string) => new ApplinkError(code, 'x', 'test');

export interface Harness {
  app: ReturnType<typeof buildApp>;
  queue: JobQueue & Partial<Pick<MemoryQueue, 'idle' | 'deadLetters'>>;
  stores: ReturnType<typeof createMemoryStores>;
  applink: ReturnType<typeof fakeApplink>;
  ports: DomainPorts;
  clock: { now: Date };
  /** Jobs that exhausted their retries. */
  deadLetterCount(): Promise<number>;
  /** POST a callback payload to the receiver. */
  callback(path: string, payload: unknown): Promise<unknown>;
  /** Registers a user whose opaque subscriber id is `subscriberId`. */
  addUser(subscriberId?: string): Promise<void>;
}

export async function harness(
  opts: {
    applink?: ReturnType<typeof fakeApplink> | ApplinkClient | undefined;
    ports?: Partial<DomainPorts>;
    /** Defaults to a fresh in-memory queue that retries instantly. */
    queue?: JobQueue;
  } = {},
): Promise<Harness> {
  const queue: Harness['queue'] = opts.queue ?? createMemoryQueue({ retryDelayScale: 0 });
  const stores = createMemoryStores();
  const applink = 'applink' in opts ? opts.applink : fakeApplink();
  const ports = { ...defaultDomainPorts, ...opts.ports };
  const clock = { now: new Date('2026-11-22T10:00:00Z') };
  const app = buildApp(
    { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(40), SMS_KEYWORD: 'UPOSHOM' },
    { stores, queue, applink: applink as ApplinkClient | undefined, ports, now: () => clock.now },
  );
  await app.ready();
  return {
    app,
    queue,
    stores,
    applink: applink as ReturnType<typeof fakeApplink>,
    ports,
    clock,
    deadLetterCount: async () => queue.deadLetters?.().length ?? 0,
    callback: async (path, payload) =>
      (
        await app.inject({
          method: 'POST',
          url: `/api/applink/${path}`,
          payload: payload as object,
        })
      ).json(),
    addUser: async (subscriberId = SUB) => {
      await stores.users.upsertVerified({
        msisdn: '8801959979376',
        accountType: 'INDIVIDUAL',
        subscriberId,
        subscriptionStatus: 'REGISTERED',
      });
    },
  };
}

let counter = 0;
export const nextId = (): string => `id-${++counter}`;

/** Lets a callback travel receiver -> dedupe -> queue -> consumer, and any follow-up jobs finish. */
export async function settle(h: Pick<Harness, 'queue'>): Promise<void> {
  await new Promise((r) => setTimeout(r, 25));
  await h.queue.idle?.();
  await new Promise((r) => setTimeout(r, 10));
  await h.queue.idle?.();
}
