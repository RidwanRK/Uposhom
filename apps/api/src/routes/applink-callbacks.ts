import type { FastifyInstance } from 'fastify';

/**
 * Applink inbound webhooks. Day 1 skeleton: each callback is acknowledged with S1000 so the
 * portal can register the URL. Real handling (password stripping, dedupe, pg-boss dispatch)
 * replaces the body of each handler later. Bodies are never logged: they hold phone numbers.
 */
const CALLBACK_PATHS = [
  '/sms/receive',
  '/sms/report',
  '/ussd/receive',
  '/subscription/notify',
  '/caas/charging-notification',
] as const;

export async function applinkCallbackRoutes(app: FastifyInstance): Promise<void> {
  for (const path of CALLBACK_PATHS) {
    app.post(path, async () => ({ statusCode: 'S1000', statusDetail: 'Success' }));
  }
}
