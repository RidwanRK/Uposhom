import type { FastifyInstance } from 'fastify';
import { ApiError } from '../errors.js';
import { sendApiError } from '../routes/billing.js';

export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  /** The Free tier allows one profile; `message` is 'PREMIUM', as the app's payment gate expects. */
  | 'PAYMENT_REQUIRED'
  /** The schedule engine could not schedule some items exactly; `details` says which and why. */
  | 'NEEDS_MANUAL_INPUT'
  | 'ALREADY_CONFIRMED'
  /** The dose was already taken or skipped. */
  | 'DOSE_CLOSED'
  /** Too far in the future to act on. */
  | 'DOSE_NOT_DUE'
  /** That person is linked to the profile already. */
  | 'ALREADY_LINKED'
  /** A profile needs at least one admin. */
  | 'LAST_ADMIN'
  /** The profile's own person cannot be removed or demoted by others. */
  | 'OWN_PROFILE'
  | 'LIMIT_REACHED'
  /** The AI service (OpenRouter) failed or is not reachable: try again later. */
  | 'AI_UNAVAILABLE';

/** Errors from the domain routes. Same body shape as A's ApiError, plus optional details. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    readonly httpStatus: number,
    readonly detail?: { message?: string; details?: unknown },
  ) {
    super(code);
    this.name = 'DomainError';
  }
}

/** Error handler for the domain route plugins: stable codes out, nothing internal leaked. */
export function useDomainErrors(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.httpStatus).send({
        success: false,
        error: {
          code: err.code,
          ...(err.detail?.message ? { message: err.detail.message } : {}),
          ...(err.detail?.details !== undefined ? { details: err.detail.details } : {}),
        },
      });
    }
    if (err instanceof ApiError) return sendApiError(reply, err);
    // Fastify's own client errors (malformed JSON, wrong content type, body too large).
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ success: false, error: { code: 'INVALID_INPUT' } });
    }
    app.log.error({ err: err instanceof Error ? err.name : 'unknown' }, 'domain route failed');
    return reply.code(500).send({ success: false, error: { code: 'SERVICE_TROUBLE' } });
  });
}
