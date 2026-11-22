/**
 * Applink status-code classes (references/08-status-codes.md). Built from the published list only:
 * do not add codes that are not on it.
 */

/** Platform-side, worth a bounded retry on calls that are safe to repeat. */
const TRANSIENT = new Set(['E1318', 'E1319', 'E1341', 'E1601', 'E1602', 'E1603']);

/** Provisioning or credentials are wrong. Retrying never helps; fix the portal or the env. */
const CONFIGURATION = new Set([
  'E1301',
  'E1303',
  'E1309',
  'E1311',
  'E1313',
  'E1315',
  'E1328',
  'E1331',
]);

/** Accepted, not settled. P1003 from CaaS generation: the OTP is on its way and nothing is charged. */
export const PENDING_CODES: readonly string[] = ['P1003'];

export class ApplinkError extends Error {
  readonly statusCode: string;
  readonly statusDetail: string;
  readonly service: string;

  constructor(statusCode: string, statusDetail: string, service: string) {
    super(`[${statusCode}] ${statusDetail} (${service})`);
    this.name = 'ApplinkError';
    this.statusCode = statusCode;
    this.statusDetail = statusDetail;
    this.service = service;
  }

  get retryable(): boolean {
    return TRANSIENT.has(this.statusCode);
  }

  get isConfiguration(): boolean {
    return CONFIGURATION.has(this.statusCode);
  }
}

/** Network failure, timeout, non-JSON answer or a refused local guard. Not an Applink status. */
export class ApplinkTransportError extends Error {
  readonly service: string;

  constructor(message: string, service: string) {
    super(`${message} (${service})`);
    this.name = 'ApplinkTransportError';
    this.service = service;
  }
}

/** Calling a service whose endpoint variable is unset: the API is not enabled for this app. */
export class ApplinkNotConfiguredError extends Error {
  constructor(service: string) {
    super(
      `[applink] ${service} is not configured: the API is not enabled for this application, ` +
        'or its URL variable is missing from the environment',
    );
    this.name = 'ApplinkNotConfiguredError';
  }
}
