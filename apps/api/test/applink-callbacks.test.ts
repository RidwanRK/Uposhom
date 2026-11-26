import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { CallbackEvent } from '../src/callbacks/events.js';

const PATHS = ['sms/receive', 'sms/report', 'subscription/notify', 'caas/charging-notification'];

const ACK = { statusCode: 'S1000', statusDetail: 'Success' };

function setup(applicationId?: string) {
  const events: CallbackEvent[] = [];
  const app = buildApp(
    { NODE_ENV: 'test', APPLINK_CALLBACK_PATH_KEY: 'abc123', APPLINK_APP_ID: applicationId },
    {
      callbackSink: {
        handle: async (e) => {
          events.push(e);
        },
      },
    },
  );
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/applink/abc123/${path}`,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      headers: { 'content-type': 'application/json;charset=utf-8', ...headers },
    });
  return { app, events, post };
}

const VALID = {
  'sms/receive': {
    version: '1.0',
    applicationId: 'APP_1',
    sourceAddress: 'tel:8801959979376',
    message: 'UPOSHOM 1',
    requestId: 'r1',
    encoding: '0',
  },
  'sms/report': {
    destinationAddress: 'tel:8801959979376',
    timeStamp: '2611221030',
    requestId: 'r2',
    deliveryStatus: 'DELIVERED',
  },
  'subscription/notify': {
    timeStamp: '20261122103000',
    version: '1.0',
    applicationId: 'APP_1',
    password: 'SECRET-API-KEY',
    subscriberId: 'tel:8801959979376',
    frequency: 'monthly',
    status: 'REGISTERED',
  },
  'caas/charging-notification': {
    externalTrxId: 'trx1',
    statusCode: 'S1000',
    paidAmount: '5.00',
    balanceDue: '0.00',
    internalTrxId: 'i1',
  },
} as const;

describe('Applink callbacks', () => {
  it.each(PATHS)('POST /api/applink/<key>/%s acks S1000 and hands the event on', async (path) => {
    const { app, events, post } = setup();
    const res = await post(path, VALID[path as keyof typeof VALID]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ACK);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await app.close();
  });

  it('does not answer without the key', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/applink/sms/receive', payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('acknowledges malformed, empty and non-JSON bodies without a 4xx or 5xx', async () => {
    const { app, events, post } = setup();
    for (const body of ['{not json', '', 'plain text']) {
      const res = await post('sms/receive', body);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(ACK);
    }
    const text = await post('sms/receive', 'hello', { 'content-type': 'text/plain' });
    expect(text.json()).toEqual(ACK);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(0);
    await app.close();
  });

  it('acknowledges and discards a payload missing required fields', async () => {
    const { app, events, post } = setup();
    const res = await post('sms/receive', { message: 'no source or requestId' });
    expect(res.json()).toEqual(ACK);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(0);
    await app.close();
  });

  it("drops another application's payload", async () => {
    const { app, events, post } = setup('APP_MINE');
    const res = await post('sms/receive', { ...VALID['sms/receive'], applicationId: 'APP_OTHER' });
    expect(res.json()).toEqual(ACK);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toHaveLength(0);
    await app.close();
  });

  it('processes the same callback twice only once (redelivery)', async () => {
    const { app, events, post } = setup();
    await post('caas/charging-notification', VALID['caas/charging-notification']);
    await post('caas/charging-notification', VALID['caas/charging-notification']);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toHaveLength(1);
    // a different status for the same transaction is a different event
    await post('caas/charging-notification', {
      ...VALID['caas/charging-notification'],
      statusCode: 'E1308',
    });
    await vi.waitFor(() => expect(events).toHaveLength(2));
    await app.close();
  });

  it('strips the API key the subscriber notification carries before anything sees it', async () => {
    const { app, events, post } = setup();
    await post('subscription/notify', VALID['subscription/notify']);
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(JSON.stringify(events[0])).not.toContain('SECRET-API-KEY');
    expect(events[0]?.data).not.toHaveProperty('password');
    await app.close();
  });

  it('accepts subscriber notification with numeric or missing timeStamp', async () => {
    const { app, events, post } = setup();
    const withoutTs: Record<string, unknown> = { ...VALID['subscription/notify'] };
    delete withoutTs['timeStamp'];
    expect((await post('subscription/notify', withoutTs)).json()).toEqual(ACK);
    expect(
      (await post('subscription/notify', { ...withoutTs, timeStamp: 20261122103001 })).json(),
    ).toEqual(ACK);
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]?.data).toMatchObject({ timeStamp: '20261122103001' });
    await app.close();
  });

  it('still acknowledges when the downstream handler throws', async () => {
    const app = buildApp(
      { NODE_ENV: 'test', APPLINK_CALLBACK_PATH_KEY: 'abc123' },
      {
        callbackSink: {
          handle: async () => {
            throw new Error('queue down');
          },
        },
      },
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/applink/abc123/sms/receive',
      payload: VALID['sms/receive'],
    });
    expect(res.json()).toEqual(ACK);
    await app.close();
  });
});
