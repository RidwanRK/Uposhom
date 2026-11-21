import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config/env.js';

export function buildApp(config: Pick<Config, 'NODE_ENV'>): FastifyInstance {
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

  return app;
}
