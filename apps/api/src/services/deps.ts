import type { ApplinkClient } from '@uposhom/applink-client';
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
  log: Logger;
  now: () => Date;
  /** The keyword subscribers put at the start of an MO SMS, for example UPOSHOM. */
  smsKeyword: string;
  /** Only a provisioned alias works (else E1331). Leave unset to use the platform default. */
  smsSourceAddress?: string | undefined;
}
