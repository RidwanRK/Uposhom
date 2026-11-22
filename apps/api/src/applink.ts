import { createApplinkClient, type ApplinkClient, type ServiceName } from '@uposhom/applink-client';
import { noopAlerter, type Alerter } from './ops/alerts.js';
import type { Config } from './config/env.js';

const ENDPOINT_VARS: Record<ServiceName, keyof Config> = {
  smsSend: 'APPLINK_SMS_SEND_URL',
  subscriptionSend: 'APPLINK_SUBSCRIPTION_SEND_URL',
  subscriptionQueryBase: 'APPLINK_SUBSCRIPTION_QUERY_BASE_URL',
  subscriptionChargingInfo: 'APPLINK_SUBSCRIPTION_CHARGING_INFO_URL',
  otpRequest: 'APPLINK_OTP_REQUEST_URL',
  otpVerify: 'APPLINK_OTP_VERIFY_URL',
  caasOtpGeneration: 'APPLINK_CAAS_DEBIT_URL',
  caasOtpVerify: 'APPLINK_CAAS_OTP_VERIFY_URL',
};

/**
 * The one place Config becomes an Applink client. Pointing the endpoint variables at
 * scripts/mock-applink.mjs is the only local-versus-live switch; never branch on NODE_ENV here.
 * Returns undefined until credentials arrive, so the app still boots and serves /healthz.
 */
export function createApplinkFromConfig(
  config: Partial<Pick<Config, 'APPLINK_APP_ID' | 'APPLINK_PASSWORD'>> &
    Partial<Record<(typeof ENDPOINT_VARS)[ServiceName], string | undefined>>,
  alerts: Alerter = noopAlerter,
): ApplinkClient | undefined {
  if (!config.APPLINK_APP_ID || !config.APPLINK_PASSWORD) return undefined;
  const endpoints: Partial<Record<ServiceName, string>> = {};
  for (const [service, variable] of Object.entries(ENDPOINT_VARS) as [
    ServiceName,
    keyof Config,
  ][]) {
    const url = config[variable as keyof typeof config];
    if (typeof url === 'string' && url) endpoints[service] = url;
  }
  return createApplinkClient({
    applicationId: config.APPLINK_APP_ID,
    password: config.APPLINK_PASSWORD,
    endpoints,
    // Configuration-class errors (E1303 wrong IP, E1313 bad credentials, E1309 not provisioned...)
    // mean the integration is down: tell a human. Retrying never helps.
    onError: (err) => {
      if (err.isConfiguration) {
        alerts.alert('applink-configuration-error', {
          statusCode: err.statusCode,
          service: err.service,
        });
      }
    },
  });
}
