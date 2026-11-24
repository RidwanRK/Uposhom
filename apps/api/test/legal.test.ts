import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DEFAULT_BILLING, billingFromEnv } from '../src/billing/config.js';

const get = (app: ReturnType<typeof buildApp>, url: string) => app.inject({ method: 'GET', url });

describe('public legal pages', () => {
  it.each(['/legal/terms', '/legal/privacy', '/support'])(
    '%s is public HTML with the contact and a safe content policy',
    async (url) => {
      const app = buildApp({
        NODE_ENV: 'test',
        SUPPORT_EMAIL: 'help@uposhom.example',
        SUPPORT_PHONE: '+880 1700 000000',
      });
      const res = await get(app, url); // no Authorization header: these pages are public
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.body).toContain('help@uposhom.example');
      expect(res.body).toContain('+880 1700 000000');
      expect(res.body).toContain('<title>');
      expect(res.body).not.toContain('undefined');
      await app.close();
    },
  );

  it('terms state the price, the renewal, how to cancel and how to stop messages', async () => {
    const app = buildApp({ NODE_ENV: 'test', SMS_KEYWORD: 'UPOSHOM' });
    const body = (await get(app, '/legal/terms')).body;
    expect(body).toContain('30.00 BDT per month');
    expect(body).toContain('renewing automatically');
    expect(body).toContain('a doctor summary costs 2.00 BDT');
    expect(body).toContain('scan costs 5.00 BDT');
    expect(body).toContain('STOP');
    expect(body).toContain('UPOSHOM 1');
    expect(body).toContain('999');
    expect(body).toMatch(/does <strong>not<\/strong> give medical advice/);
    await app.close();
  });

  it('prices and the keyword follow the configuration, so the text cannot drift from the system', async () => {
    const billing = billingFromEnv({
      PLAN_FAMILY_CIRCLE_AMOUNT: '49.50',
      CAAS_AMOUNT_DOCTOR_SUMMARY: '8.00',
    });
    const app = buildApp({ NODE_ENV: 'test', SMS_KEYWORD: 'DAWAI' }, { billing });
    const body = (await get(app, '/legal/terms')).body;
    expect(body).toContain('49.50 BDT per month');
    expect(body).toContain('a doctor summary costs 8.00 BDT');
    expect(body).toContain('DAWAI 1');
    expect(body).not.toContain('30.00');
    await app.close();
  });

  it('the privacy policy states the retention periods the code actually enforces', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const body = (await get(app, '/legal/privacy')).body;
    expect(body).toContain('Message delivery records: 90 days');
    expect(body).toContain('removed 1 day after they expire');
    expect(body).toContain('30 days after they end');
    expect(body).toMatch(/stored encrypted/);
    expect(body).toMatch(/do not sell your data/);
    await app.close();
  });

  it('escapes the configured contact, so a bad value cannot inject markup', async () => {
    const app = buildApp({
      NODE_ENV: 'test',
      SUPPORT_EMAIL: '"><script>alert(1)</script>',
      SUPPORT_PHONE: '<img src=x onerror=alert(1)>',
    });
    for (const url of ['/legal/terms', '/legal/privacy', '/support']) {
      const body = (await get(app, url)).body;
      expect(body, url).not.toContain('<script>');
      expect(body, url).not.toContain('<img');
    }
    await app.close();
  });

  it('shows a sensible fallback when no contact is configured yet', async () => {
    const app = buildApp({ NODE_ENV: 'test' });
    const body = (await get(app, '/legal/terms')).body;
    expect(body).toContain('the support contact listed in the app');
    expect(DEFAULT_BILLING.plans.FAMILY_CIRCLE.amount).toBe('30.00');
    await app.close();
  });
});
