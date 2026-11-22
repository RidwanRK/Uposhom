import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('applies defaults in development', () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.HOST).toBe('0.0.0.0');
  });

  it('refuses to boot in production without APPLINK_CALLBACK_PATH_KEY', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', APPLINK_CALLBACK_PATH_KEY: '   ' })).toThrow(
      /APPLINK_CALLBACK_PATH_KEY/,
    );
  });

  it('boots in production when the callback path key and JWT secret are set', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      APPLINK_CALLBACK_PATH_KEY: 'k3y',
      JWT_SECRET: 'x'.repeat(32),
    });
    expect(cfg.APPLINK_CALLBACK_PATH_KEY).toBe('k3y');
  });

  it('refuses to boot in production without a long enough JWT_SECRET', () => {
    const base = { NODE_ENV: 'production', APPLINK_CALLBACK_PATH_KEY: 'k3y' };
    expect(() => loadConfig(base)).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('allows an empty callback path key in test and development', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('requires both CaaS URLs or neither', () => {
    expect(() => loadConfig({ APPLINK_CAAS_DEBIT_URL: 'http://127.0.0.1:8089/d' })).toThrow(
      /both be set, or neither/,
    );
    expect(() => loadConfig({ APPLINK_CAAS_OTP_VERIFY_URL: 'http://127.0.0.1:8089/v' })).toThrow(
      /both be set, or neither/,
    );
    expect(() =>
      loadConfig({
        APPLINK_CAAS_DEBIT_URL: 'http://127.0.0.1:8089/d',
        APPLINK_CAAS_OTP_VERIFY_URL: 'http://127.0.0.1:8089/v',
      }),
    ).not.toThrow();
  });

  it('treats blank endpoint variables as unset', () => {
    const cfg = loadConfig({ APPLINK_SMS_SEND_URL: '' });
    expect(cfg.APPLINK_SMS_SEND_URL).toBeUndefined();
  });

  it('rejects an invalid endpoint URL or port', () => {
    expect(() => loadConfig({ APPLINK_SMS_SEND_URL: 'not-a-url' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: '99999' })).toThrow(ConfigError);
  });
});
