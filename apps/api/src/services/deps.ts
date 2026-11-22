import type { ApplinkClient } from '@uposhom/applink-client';
import type { BillingConfig } from '../billing/config.js';
import type { Alerter } from '../ops/alerts.js';
import type { DomainPorts } from '../ports.js';
import type { JobQueue } from '../queue/types.js';
import type { Stores } from '../stores/types.js';

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Everything a queue consumer needs. No Fastify in here, so the worker app can reuse the consumers. */
export interface ServiceDeps {
  stores: Stores;
  /** Undefined until Applink credentials arrive. Consumers then fail closed instead of crashing. */
  applink: ApplinkClient | undefined;
  queue: JobQueue;
  ports: DomainPorts;
  /** Plan prices, one-off charge amounts and monthly allowances. */
  billing: BillingConfig;
  log: Logger;
  /** Webhook alerts for things a human must look at. A no-op when no webhook is configured. */
  alerts: Alerter;
  now: () => Date;
  /** The keyword subscribers put at the start of an MO SMS, for example UPOSHOM. */
  smsKeyword: string;
  /**
   * Minimum gap between two outbound SMS, in milliseconds: the per-second transaction ceiling
   * Applink enforces (E1318). Unset means no spacing. Set from SMS_MAX_PER_SECOND once Applink
   * tells us the limit for this application.
   */
  smsMinIntervalMs?: number | undefined;
  /** Only a provisioned alias works (else E1331). Leave unset to use the platform default. */
  smsSourceAddress?: string | undefined;
}
