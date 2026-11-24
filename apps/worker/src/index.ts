/**
 * Placeholder container.
 *
 * Every pg-boss consumer (reminder ladder, SMS send, refill and follow-up reminders, the weekly
 * digest, charge reconciliation, the subscription sweep and retention) runs inside the API process
 * today: see apps/api/src/jobs and apps/api/src/domain/register.ts. The queue lives in Postgres, so
 * nothing is lost on a restart. Moving the consumers here is optional and would need the API to stop
 * registering them. The heartbeat keeps the container alive for the compose healthcheck.
 */
const HEARTBEAT_MS = 60_000;

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'worker started (placeholder: jobs run in the API process)',
  }),
);

const timer = setInterval(() => {
  console.log(JSON.stringify({ level: 'debug', msg: 'worker heartbeat' }));
}, HEARTBEAT_MS);

const shutdown = (signal: string): void => {
  console.log(JSON.stringify({ level: 'info', msg: 'worker shutting down', signal }));
  clearInterval(timer);
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
