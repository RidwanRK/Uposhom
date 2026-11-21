import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config/env.js';
import { applinkCallbackRoutes } from './routes/applink-callbacks.js';

export function buildApp(
  config: Pick<Config, 'NODE_ENV'> & Partial<Pick<Config, 'APPLINK_CALLBACK_PATH_KEY'>>,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      // Logs hold identifiers only: never tokens, message bodies or OTPs.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true, // behind Caddy
  });

  // Liveness probe for the deploy smoke test and UptimeRobot.
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Applink callbacks live at /api/applink/<key>/..., the key being an unguessable path segment.
  const key = config.APPLINK_CALLBACK_PATH_KEY?.trim();
  const prefix = key ? `/api/applink/${key}` : '/api/applink';
  void app.register(applinkCallbackRoutes, { prefix });

  return app;
}
