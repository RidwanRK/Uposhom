/**
 * One error type for every route: a stable machine code (never a raw Applink status code), the
 * HTTP status, and an optional retry hint. The app maps `code` to a Bangla message.
 */
export type ApiErrorCode =
  // auth and OTP (packages/shared authErrorCodes plus a few more)
  | 'NUMBER_NOT_ACCEPTED'
  | 'NUMBER_BLOCKED'
  | 'NOT_ON_TEST_LIST'
  | 'SERVICE_TROUBLE'
  | 'RATE_LIMITED'
  | 'OTP_WRONG'
  | 'OTP_EXPIRED'
  | 'INVALID_INPUT'
  | 'INVALID_REFRESH'
  | 'UNAUTHENTICATED'
  | 'STEP_UP_REQUIRED'
  // billing
  | 'CONSENT_REQUIRED'
  | 'NOT_REGISTERED'
  | 'INSUFFICIENT_BALANCE'
  | 'CHARGE_NOT_FOUND'
  | 'CHARGE_NOT_PAYABLE'
  | 'QUOTA_EXCEEDED'
  | 'PAYMENT_UNAVAILABLE'
  | 'FORBIDDEN';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ApiErrorCode, httpStatus: number, retryAfterSeconds?: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}
