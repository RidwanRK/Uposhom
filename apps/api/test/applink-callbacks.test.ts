import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const PATHS = [
  'sms/receive',
  'sms/report',
  'ussd/receive',
  'subscription/notify',
  'caas/charging-notification',
];

describe('Applink callbacks', () => {
  it.each(PATHS)('POST /api/applink/<key>/%s acks S1000', async (path) => {
    const app = buildApp({ NODE_ENV: 'test', APPLINK_CALLBACK_PATH_KEY: 'abc123' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/applink/abc123/${path}`,
      payload: { version: '1.0' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ statusCode: 'S1000', statusDetail: 'Success' });
    await app.close();
  });

  it('does not answer without the key', async () => {
    const app = buildApp({ NODE_ENV: 'test', APPLINK_CALLBACK_PATH_KEY: 'abc123' });
    const res = await app.inject({ method: 'POST', url: '/api/applink/sms/receive', payload: {} });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
