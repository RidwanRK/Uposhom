/**
 * pg-boss worker supervisor.
 *
 * Day 0 placeholder: no queues yet. B and A add the consumers (reminders, escalation, SMS send,
 * reconciliation, digests) as the pg-boss jobs land. The heartbeat keeps the container alive and
 * lets the compose healthcheck and logs show the worker is up.
 */
const HEARTBEAT_MS = 60_000;

console.log(JSON.stringify({ level: 'info', msg: 'worker started (no queues yet)' }));

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
