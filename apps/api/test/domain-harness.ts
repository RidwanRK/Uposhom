import type { ApplinkClient } from '@uposhom/applink-client';
import { buildApp } from '../src/app.js';
import { createTokenService } from '../src/auth/tokens.js';
import type { PushSender } from '../src/domain/push.js';
import type { DomainStore } from '../src/domain/types.js';
import { createMemoryQueue } from '../src/queue/memory.js';
import { createMemoryStores } from '../src/stores/memory.js';
import type { AccountType, UserRecord } from '../src/stores/types.js';
import { fakeApplink, SUB } from './platform.js';

const SECRET = 'x'.repeat(40);

/**
 * Workstream B's test app: A's real platform with B's real domain wired in through the ports
 * (A's own harness in platform.ts swaps them for no-ops, which is right for A's tests). Same
 * clock and fakes as A's harness.
 */
export async function domainHarness(opts: { store?: DomainStore; push?: PushSender } = {}) {
  const queue = createMemoryQueue({ retryDelayScale: 0 });
  const stores = createMemoryStores();
  const applink = fakeApplink();
  const clock = { now: new Date('2026-11-22T10:00:00Z') };
  const app = buildApp(
    { NODE_ENV: 'test', JWT_SECRET: SECRET, SMS_KEYWORD: 'UPOSHOM' },
    {
      stores,
      queue,
      applink: applink as unknown as ApplinkClient,
      now: () => clock.now,
      domain: {
        ...(opts.store ? { store: opts.store } : {}),
        ...(opts.push ? { push: opts.push } : {}),
      },
    },
  );
  await app.ready();
  const tokens = createTokenService(SECRET, () => clock.now);
  const bearer = async (user: UserRecord) => ({
    authorization: `Bearer ${await tokens.signAccess({
      userId: user.id,
      role: user.accountType === 'PHARMACY' ? 'PHARMACY_OWNER' : 'FAMILY_ADMIN',
      isAdmin: user.isAdmin,
    })}`,
  });
  return {
    app,
    queue,
    stores,
    applink,
    clock,
    bearer,
    addUser: (subscriberId = SUB, o: { msisdn?: string; accountType?: AccountType } = {}) =>
      stores.users.upsertVerified({
        msisdn: o.msisdn ?? '8801959979376',
        accountType: o.accountType ?? 'INDIVIDUAL',
        subscriberId,
        subscriptionStatus: 'REGISTERED',
      }),
    callback: async (path: string, payload: object) =>
      (await app.inject({ method: 'POST', url: `/api/applink/${path}`, payload })).json(),
    /** Calls a route as a signed-in user. */
    api: async (
      user: UserRecord,
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: string,
      payload?: object,
      headers: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url: `/api/v1${url}`,
        headers: { ...(await bearer(user)), ...headers },
        ...(payload ? { payload } : {}),
      }),
  };
}

export type DomainHarness = Awaited<ReturnType<typeof domainHarness>>;
