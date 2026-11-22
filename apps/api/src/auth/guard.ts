import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AccessClaims, TokenService } from './tokens.js';

export interface AuthContext extends AccessClaims {
  /** The raw bearer token, only for passing to a downstream call. Never log it. */
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `authenticate`. Null on routes that do not use it. */
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** preHandler: requires a valid `Authorization: Bearer <access token>`. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * preHandler, after `authenticate`: requires a step-up token (header `X-Step-Up-Token`) issued
     * to the same user in the last five minutes. For removing a person, deleting data, sharing a
     * report: anything that should re-prove the phone.
     */
    requireStepUp: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const deny = (reply: FastifyReply, status: number, code: string): FastifyReply =>
  reply.code(status).send({ success: false, error: { code } });

/** Decorates the app with `authenticate` and `requireStepUp`. Call before registering routes. */
export function registerAuthGuard(app: FastifyInstance, tokens: TokenService): void {
  app.decorateRequest('auth', null);

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null;
    const claims = match?.[1] ? await tokens.verifyAccess(match[1]) : null;
    if (!claims || !match?.[1]) return void deny(reply, 401, 'UNAUTHENTICATED');
    req.auth = { ...claims, token: match[1] };
  });

  app.decorate('requireStepUp', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) return void deny(reply, 401, 'UNAUTHENTICATED');
    const raw = req.headers['x-step-up-token'];
    const subject = typeof raw === 'string' ? await tokens.verifyStepUp(raw) : null;
    if (subject !== req.auth.userId) return void deny(reply, 403, 'STEP_UP_REQUIRED');
  });
}
