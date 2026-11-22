import { z } from 'zod';

/**
 * Single config module. Every environment variable the API reads is validated here at
 * startup, and the process refuses to boot if anything is wrong (Master Plan section 8).
 *
 * Applink config is one endpoint variable per enabled service. An unset variable means that
 * API is not enabled. Pointing these at scripts/mock-applink.mjs is the only local-versus-live
 * switch, so never branch on NODE_ENV to choose a URL.
 *
 * Applink credentials are optional on Day 0 (they arrive by email after approval, target Day 2).
 */

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional(),
);

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: optionalString,

    // Job queue. `memory` loses queued jobs on restart; `pgboss` keeps them in Postgres and needs
    // DATABASE_URL. Keep `memory` until the Postgres stores land: pg-boss would otherwise replay
    // jobs against an sms_log and sessions that restarted empty.
    QUEUE_DRIVER: z.enum(['memory', 'pgboss']).default('memory'),

    // HMAC secret for access tokens (at least 32 characters). Mandatory in production.
    JWT_SECRET: optionalString,

    // Applink credentials (set when approval lands)
    APPLINK_APP_ID: optionalString,
    APPLINK_PASSWORD: optionalString,

    // Keyword subscribers put at the start of an MO SMS (UPOSHOM 1). Confirm with Applink.
    SMS_KEYWORD: z.string().trim().min(1).default('UPOSHOM'),
    // Only a provisioned alias works as the SMS sender (else E1331). Unset uses the default.
    APPLINK_SMS_SOURCE_ADDRESS: optionalString,

    // Unguessable path segment for the five callback URLs. Mandatory in production.
    APPLINK_CALLBACK_PATH_KEY: z.string().default(''),

    // One endpoint variable per enabled Applink service
    APPLINK_SMS_SEND_URL: optionalUrl,
    APPLINK_USSD_SEND_URL: optionalUrl,
    APPLINK_SUBSCRIPTION_SEND_URL: optionalUrl,
    APPLINK_SUBSCRIPTION_QUERY_BASE_URL: optionalUrl,
    APPLINK_SUBSCRIPTION_CHARGING_INFO_URL: optionalUrl,
    APPLINK_OTP_REQUEST_URL: optionalUrl,
    APPLINK_OTP_VERIFY_URL: optionalUrl,
    APPLINK_CAAS_DEBIT_URL: optionalUrl,
    APPLINK_CAAS_OTP_VERIFY_URL: optionalUrl,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.APPLINK_CALLBACK_PATH_KEY.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APPLINK_CALLBACK_PATH_KEY'],
        message: 'must be set in production (unguessable callback path segment)',
      });
    }

    if (env.QUEUE_DRIVER === 'pgboss' && env.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'must be set when QUEUE_DRIVER=pgboss',
      });
    }

    if (env.NODE_ENV === 'production' && (env.JWT_SECRET ?? '').length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message:
          'must be set in production (at least 32 characters, for example openssl rand -hex 32)',
      });
    }

    // Charging needs both CaaS endpoints, or neither: with only one, a started charge
    // cannot be completed.
    const hasDebit = env.APPLINK_CAAS_DEBIT_URL !== undefined;
    const hasVerify = env.APPLINK_CAAS_OTP_VERIFY_URL !== undefined;
    if (hasDebit !== hasVerify) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasDebit ? 'APPLINK_CAAS_OTP_VERIFY_URL' : 'APPLINK_CAAS_DEBIT_URL'],
        message:
          'APPLINK_CAAS_DEBIT_URL and APPLINK_CAAS_OTP_VERIFY_URL must both be set, or neither',
      });
    }
  });

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  return result.data;
}
