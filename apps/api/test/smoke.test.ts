import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSmoke } from '../src/ops/smoke.js';
import { startMockApplink, type MockApplink } from './helpers.js';

let mock: MockApplink;
beforeAll(async () => {
  mock = await startMockApplink(18095);
});
afterAll(() => mock.stop());

const env = (scenario = '') => ({
  APPLINK_APP_ID: 'APP_MOCK',
  APPLINK_PASSWORD: 'mock-not-a-real-password',
  APPLINK_SUBSCRIPTION_QUERY_BASE_URL: `http://127.0.0.1:18095${scenario}/subscription/query-base`,
});

describe('applink smoke test (Base Size)', () => {
  it('passes against a working Applink and says what it proved', async () => {
    const r = await runSmoke(env());
    expect(r.ok).toBe(true);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toMatch(/Credentials, provisioning and egress IP all work/);
    expect(await mock.badRequests()).toEqual([]);
  });

  it.each([
    ['E1303', /curl -4 https:\/\/api\.ipify\.org/],
    ['E1313', /APPLINK_APP_ID and APPLINK_PASSWORD/],
    ['E1309', /not enabled for this application/],
    ['E1315', /endpoint URL/],
  ])('turns %s into the next step to take', async (code, hint) => {
    const r = await runSmoke(env(`/fail-${code}`));
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain(code);
    expect(r.lines.join('\n')).toMatch(hint);
  });

  it('never prints the password', async () => {
    for (const scenario of ['', '/fail-E1313']) {
      const r = await runSmoke(env(scenario));
      expect(r.lines.join('\n')).not.toContain('mock-not-a-real-password');
    }
  });

  it('lists exactly what is missing and exits 2', async () => {
    const r = await runSmoke({ APPLINK_APP_ID: 'x' });
    expect(r.code).toBe(2);
    expect(r.lines[0]).toBe('Missing: APPLINK_PASSWORD, APPLINK_SUBSCRIPTION_QUERY_BASE_URL.');
  });

  it('reports an unreachable Applink as a connection problem', async () => {
    const r = await runSmoke({
      ...env(),
      APPLINK_SUBSCRIPTION_QUERY_BASE_URL: 'http://127.0.0.1:1/subscription/query-base',
    });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toMatch(/FAILED to reach Applink/);
  });
});
