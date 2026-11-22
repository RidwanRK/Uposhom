import type { FastifyInstance } from 'fastify';
import {
  caasInitiateBody,
  caasInitiateResponse,
  caasVerifyBody,
  caasVerifyResponse,
} from '@uposhom/shared';
import { ApiError } from '../errors.js';
import type { CaasService } from '../billing/caas.js';
import type { UserStore } from '../stores/types.js';
import { useApiErrors } from './billing.js';

/**
 * /api/v1/billing/caas: pay-per-use charging. The app sends a purpose, never an amount: the price
 * comes from server config, and equals what the payment sheet disclosed.
 */
export function caasRoutes(deps: { users: UserStore; caas: CaasService }) {
  return async function register(app: FastifyInstance): Promise<void> {
    useApiErrors(app);
    app.addHook('preHandler', app.authenticate);

    const currentUser = async (userId: string) => {
      const user = await deps.users.findById(userId);
      if (!user) throw new ApiError('UNAUTHENTICATED', 401);
      return user;
    };

    app.post('/initiate', async (req, reply) => {
      const body = caasInitiateBody.safeParse(req.body);
      if (!body.success) throw new ApiError('INVALID_INPUT', 400);
      const user = await currentUser(req.auth?.userId ?? '');
      const res = await deps.caas.initiate(user, {
        purpose: body.data.purpose,
        wording: body.data.consentWording,
        ip: req.ip,
      });
      return reply.send(caasInitiateResponse.parse(res));
    });

    app.post('/verify', async (req, reply) => {
      const body = caasVerifyBody.safeParse(req.body);
      if (!body.success) throw new ApiError('INVALID_INPUT', 400);
      const user = await currentUser(req.auth?.userId ?? '');
      const res = await deps.caas.verify(user, {
        chargeId: body.data.chargeId,
        otp: body.data.otp,
      });
      return reply.send(caasVerifyResponse.parse(res));
    });

    app.get('/:chargeId', async (req, reply) => {
      const { chargeId } = req.params as { chargeId: string };
      const user = await currentUser(req.auth?.userId ?? '');
      return reply.send(caasVerifyResponse.parse(await deps.caas.status(user, chargeId)));
    });
  };
}
