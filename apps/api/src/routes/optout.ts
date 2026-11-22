import type { FastifyInstance } from 'fastify';
import { okResponse, optOutBody } from '@uposhom/shared';
import { ApiError } from '../errors.js';
import type { SubscriptionService } from '../billing/subscriptions.js';
import type { PrivacyService } from '../privacy/erase.js';
import type { UnregisterService } from '../subscription/unregister.js';
import type { UserStore } from '../stores/types.js';
import { useApiErrors } from './billing.js';

/**
 * POST /api/v1/account/opt-out. Opt-out is available in the app, by SMS and on request: STOP is
 * honoured at once (messages to the number stop, including queued ones) and Applink Unregister
 * follows from the queue until its status says UNREGISTERED.
 *
 * The rest of /account (settings, delete-my-data) belongs to the domain layer.
 */
export function optOutRoutes(deps: {
  users: UserStore;
  unregister: UnregisterService;
  subscriptions: SubscriptionService;
  privacy: PrivacyService;
}) {
  return async function register(app: FastifyInstance): Promise<void> {
    useApiErrors(app);
    app.addHook('preHandler', app.authenticate);

    // Delete my data. Needs a step-up token: the phone is re-proved first.
    app.delete('/', { preHandler: app.requireStepUp }, async (req, reply) => {
      const user = await deps.users.findById(req.auth?.userId ?? '');
      if (!user) throw new ApiError('UNAUTHENTICATED', 401);
      await deps.privacy.eraseAccount(user);
      return reply.send(okResponse.parse({ success: true }));
    });

    app.post('/opt-out', async (req, reply) => {
      const body = optOutBody.safeParse(req.body);
      if (!body.success) throw new ApiError('INVALID_INPUT', 400);
      const user = await deps.users.findById(req.auth?.userId ?? '');
      if (!user?.subscriberId) throw new ApiError('UNAUTHENTICATED', 401);

      if (body.data.scope === 'SUBSCRIPTION') {
        await deps.subscriptions.unsubscribe(user);
      } else {
        // SMS and ALL both end the Applink subscription: Applink keeps one per subscriber, so
        // there is no way to keep it and stop only the messages.
        await deps.subscriptions.unsubscribe(user);
      }
      return reply.send(okResponse.parse({ success: true }));
    });
  };
}
