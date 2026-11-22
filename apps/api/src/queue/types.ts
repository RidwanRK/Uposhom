/**
 * Job queue port. Production target is pg-boss on the VM's Postgres (Master Plan section 4); Day 2
 * ships an in-memory implementation so the consumers run and are tested without a database. Code
 * outside src/queue only depends on this interface.
 */

export interface JobOptions {
  /** While a job with this key is queued or running, another send with it is dropped. */
  singletonKey?: string;
  delaySeconds?: number;
  /** Extra attempts after the first failure. Default 0: a job that throws goes to the dead letters. */
  retryLimit?: number;
  /** Base delay before a retry, doubling on every attempt (exponential backoff). Default 0. */
  retryDelaySeconds?: number;
}

export interface Job<T = unknown> {
  id: string;
  name: string;
  data: T;
  retryCount: number;
}

export interface DeadLetter {
  job: Job;
  error: string;
}

export interface JobQueue {
  /** Resolves to the job id, or null when dropped by a singletonKey. */
  send(name: string, data: unknown, options?: JobOptions): Promise<string | null>;
  /** One handler per queue. Throwing means failure: retried per the job's options, then dead-lettered. */
  work<T>(name: string, handler: (job: Job<T>) => Promise<void>): void;
  /**
   * Sends `name` on a cron schedule, in the given time zone (default Asia/Dhaka). Idempotent:
   * registering the same name again replaces the schedule, so the API and the worker may both
   * call it. Takes effect on start().
   */
  schedule(name: string, cron: string, options?: { tz?: string }): Promise<void>;
  /** Jobs that used up their retries, where the queue can tell. For the daily review. */
  deadLetterCount?(): Promise<number>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
