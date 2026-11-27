import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  entitlementsResponse,
  subscribeBody,
  subscribeOtpRequestResponse,
  subscribeOtpVerifyBody,
} from '@uposhom/shared';
import { ApiError } from '../errors.js';
import type { EntitlementService } from '../billing/entitlements.js';
import type { SubscriptionOtp, SubscriptionService } from '../billing/subscriptions.js';
import type { UserStore } from '../stores/types.js';

export function sendApiError(reply: FastifyReply, err: ApiError): FastifyReply {
  return reply.code(err.httpStatus).send({
    success: false,
    error: {
      code: err.code,
      ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    },
  });
}

/** Shared error handler for authenticated routes: ApiError in, stable code out, nothing leaked. */
export function useApiErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) return sendApiError(reply, err);
    app.log.error({ err: err instanceof Error ? err.name : 'unknown' }, 'route failed');
    return reply.code(500).send({ success: false, error: { code: 'SERVICE_TROUBLE' } });
  });
}

export interface BillingRouteDeps {
  users: UserStore;
  subscriptions: SubscriptionService;
  entitlements: EntitlementService;
  /** Applink's OTP API, for the subscription flow. */
  otp: SubscriptionOtp;
}

/** /api/v1/billing: subscription status and entitlements. CaaS routes are added in caas.ts. */
export function billingRoutes(deps: BillingRouteDeps) {
  return async function register(app: FastifyInstance): Promise<void> {
    useApiErrors(app);
    app.addHook('preHandler', app.authenticate);

    const currentUser = async (userId: string) => {
      const user = await deps.users.findById(userId);
      if (!user) throw new ApiError('UNAUTHENTICATED', 401);
      return user;
    };

    // Reads the local mirror only: no Applink call on a page-load path.
    app.get('/subscription/status', async (req, reply) => {
      const user = await currentUser(req.auth?.userId ?? '');
      return reply.send(await deps.subscriptions.view(user));
    });

    // Subscribing follows Applink's OTP API (docs/otp): the OTP is sent to the subscriber, the
    // subscriber enters it in the app, and a successful verify activates the subscription.
    // Step 1: the ticked consent is recorded, then the code goes to the signed-in user's own number.
    app.post('/subscription/otp/request', async (req, reply) => {
      const body = subscribeBody.safeParse(req.body);
      if (!body.success) throw new ApiError('CONSENT_REQUIRED', 400);
      const user = await currentUser(req.auth?.userId ?? '');
      const sent = await deps.subscriptions.requestOtp(
        user,
        { wording: body.data.consentWording, ip: req.ip },
        deps.otp,
      );
      return reply.send(subscribeOtpRequestResponse.parse({ success: true, ...sent }));
    });

    // Step 2: the code. Applink verifies it and answers with the subscription status.
    app.post('/subscription/otp/verify', async (req, reply) => {
      const body = subscribeOtpVerifyBody.safeParse(req.body);
      if (!body.success) throw new ApiError('INVALID_INPUT', 400);
      const user = await currentUser(req.auth?.userId ?? '');
      return reply.send(await deps.subscriptions.verifyOtp(user, body.data.otp, deps.otp));
    });

    app.post('/subscription/unsubscribe', async (req, reply) => {
      const user = await currentUser(req.auth?.userId ?? '');
      return reply.send(await deps.subscriptions.unsubscribe(user));
    });

    app.get('/entitlements', async (req, reply) => {
      const user = await currentUser(req.auth?.userId ?? '');
      return reply.send(entitlementsResponse.parse(await deps.entitlements.view(user)));
    });
  };
}
