import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  otpRequestBody,
  otpRequestResponse,
  otpVerifyBody,
  otpVerifyResponse,
  refreshBody,
  refreshResponse,
} from '@uposhom/shared';
import { AuthError, type OtpService } from '../auth/otp-service.js';

function sendError(reply: FastifyReply, err: AuthError): FastifyReply {
  return reply.code(err.httpStatus).send({
    success: false,
    error: {
      code: err.code,
      ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
    },
  });
}

/** /api/v1/auth: OTP sign-up, refresh and logout. Applink is never called on a login path. */
export function authRoutes(otp: OtpService) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.setErrorHandler((err: unknown, _req, reply) => {
      if (err instanceof AuthError) return sendError(reply, err);
      app.log.error({ err: err instanceof Error ? err.name : 'unknown' }, 'auth route failed');
      return reply.code(500).send({ success: false, error: { code: 'SERVICE_TROUBLE' } });
    });

    app.post('/otp/request', async (req, reply) => {
      const body = otpRequestBody.safeParse(req.body);
      if (!body.success) throw new AuthError('INVALID_INPUT', 400);
      const res = await otp.requestOtp({ msisdn: body.data.msisdn, ip: req.ip });
      return reply.send(otpRequestResponse.parse({ success: true, ...res }));
    });

    app.post('/otp/verify', async (req, reply) => {
      const body = otpVerifyBody.safeParse(req.body);
      if (!body.success) throw new AuthError('INVALID_INPUT', 400);
      const session = await otp.verifyOtp(body.data);
      return reply.send(
        otpVerifyResponse.parse({
          success: true,
          token: session.token,
          refreshToken: session.refreshToken,
          user: {
            id: session.user.id,
            msisdn: session.user.msisdn,
            role: session.role,
            ...(session.user.isAdmin ? { isAdmin: true } : {}),
          },
          // The family circle is created by the domain service (workstream B), not here.
          circle: null,
        }),
      );
    });

    app.post('/refresh', async (req, reply) => {
      const body = refreshBody.safeParse(req.body);
      if (!body.success) throw new AuthError('INVALID_INPUT', 400);
      return reply.send(refreshResponse.parse(await otp.refresh(body.data.refreshToken)));
    });

    app.post('/logout', async (req, reply) => {
      const body = refreshBody.safeParse(req.body);
      if (body.success) await otp.logout(body.data.refreshToken);
      return reply.send({ success: true });
    });
  };
}
