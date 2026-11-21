import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /healthz', () => {
  it('returns 200 { status: "ok" }', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
