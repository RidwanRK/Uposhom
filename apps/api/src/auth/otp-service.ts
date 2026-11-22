import {
  ApplinkError,
  maskAddress,
  normalizeBdMsisdn,
  type ApplinkClient,
} from '@uposhom/applink-client';
import type { AccountType, Stores, UserRecord } from '../stores/types.js';
import { REFRESH_TOKEN_TTL_MS, hashRefreshToken, type Role, type TokenService } from './tokens.js';

export const OTP_VALIDITY_SECONDS = 300; // Applink OTPs are valid five minutes
export const MAX_VERIFY_ATTEMPTS = 5;

/** OTP requests are paid SMS: without these limits the endpoint is an SMS-bombing tool. */
export const LIMITS = {
  perNumber: { limit: 3, windowMs: 10 * 60 * 1000 },
  perNumberDaily: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  perIp: { limit: 10, windowMs: 10 * 60 * 1000 },
} as const;

/** Machine codes shared with the app (packages/shared authErrorCodes) plus INVALID_INPUT and INVALID_REFRESH. */
export type AuthErrorCode =
  | 'NUMBER_NOT_ACCEPTED'
  | 'NUMBER_BLOCKED'
  | 'NOT_ON_TEST_LIST'
  | 'SERVICE_TROUBLE'
  | 'RATE_LIMITED'
  | 'OTP_WRONG'
  | 'OTP_EXPIRED'
  | 'INVALID_INPUT'
  | 'INVALID_REFRESH';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, httpStatus: number, retryAfterSeconds?: number) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Maps an Applink status code to what the app is allowed to see (design.md Screen 10). */
function mapApplinkError(err: unknown): AuthError {
  if (err instanceof ApplinkError) {
    switch (err.statusCode) {
      case 'E1317':
        return new AuthError('NUMBER_NOT_ACCEPTED', 422);
      case 'E1342':
        return new AuthError('NUMBER_BLOCKED', 403);
      case 'E1343':
        return new AuthError('NOT_ON_TEST_LIST', 403);
      case 'E1850':
        return new AuthError('OTP_WRONG', 401);
      case 'E1851':
      case 'E1855':
        return new AuthError('OTP_EXPIRED', 410);
      default:
        return new AuthError('SERVICE_TROUBLE', 503); // E1856, E1603, configuration, anything else
    }
  }
  return new AuthError('SERVICE_TROUBLE', 503);
}

export interface OtpServiceDeps {
  stores: Stores;
  /** Undefined when the OTP endpoints are not configured: the service then reports SERVICE_TROUBLE. */
  applink: ApplinkClient | undefined;
  tokens: TokenService;
  log: { warn: (obj: object, msg: string) => void };
  now?: () => Date;
}

export interface VerifiedSession {
  user: UserRecord;
  role: Role;
  token: string;
  refreshToken: string;
}

export function maskMsisdn(msisdn: string): string {
  // 8801973579363 -> 019****9363 (local form, as the app shows it)
  const local = `0${msisdn.slice(3)}`;
  return `${local.slice(0, 3)}****${local.slice(-4)}`;
}

export function createOtpService(deps: OtpServiceDeps) {
  const now = deps.now ?? (() => new Date());

  async function requestOtp(input: { msisdn: string; ip: string }): Promise<{
    maskedPhone: string;
    expiresInSeconds: number;
  }> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn) throw new AuthError('NUMBER_NOT_ACCEPTED', 422);
    if (!deps.applink) throw new AuthError('SERVICE_TROUBLE', 503);

    const t = now();
    const checks = [
      [`otp:num:${msisdn}`, LIMITS.perNumber],
      [`otp:day:${msisdn}`, LIMITS.perNumberDaily],
      [`otp:ip:${input.ip}`, LIMITS.perIp],
    ] as const;
    for (const [key, rule] of checks) {
      const res = await deps.stores.rateLimit.hit(key, rule.limit, rule.windowMs, t);
      if (!res.allowed) throw new AuthError('RATE_LIMITED', 429, res.retryAfterSeconds);
    }

    // The consent row is written before the request: verify activates an Applink subscription,
    // and the screen that precedes this call discloses that (Master Plan section 8).
    await deps.stores.consents.record(
      { msisdn, kind: 'SIGNUP_OTP_V1', channel: 'APP', ip: input.ip },
      t,
    );

    let referenceNo: string | undefined;
    try {
      const res = await deps.applink.requestOtp({ subscriberId: msisdn });
      referenceNo = res.referenceNo;
    } catch (err) {
      deps.log.warn(
        {
          subscriber: maskAddress(msisdn),
          statusCode: (err as { statusCode?: string }).statusCode,
        },
        'otp request failed',
      );
      throw mapApplinkError(err);
    }
    if (!referenceNo) throw new AuthError('SERVICE_TROUBLE', 503);

    await deps.stores.otpSessions.create({
      msisdn,
      purpose: 'SIGNUP',
      referenceNo,
      expiresAt: new Date(t.getTime() + OTP_VALIDITY_SECONDS * 1000),
    });
    return { maskedPhone: maskMsisdn(msisdn), expiresInSeconds: OTP_VALIDITY_SECONDS };
  }

  async function verifyOtp(input: {
    msisdn: string;
    otp: string;
    accountType?: AccountType | undefined;
  }): Promise<VerifiedSession> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn || !/^\d{4,8}$/.test(input.otp)) throw new AuthError('INVALID_INPUT', 400);
    if (!deps.applink) throw new AuthError('SERVICE_TROUBLE', 503);

    const t = now();
    const session = await deps.stores.otpSessions.findOpen(msisdn, t);
    if (!session || session.attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new AuthError('OTP_EXPIRED', 410);
    }
    // Count the attempt before calling Applink, so a crash cannot grant a free retry.
    const attempts = await deps.stores.otpSessions.incrementAttempts(session.id);
    if (attempts > MAX_VERIFY_ATTEMPTS) throw new AuthError('OTP_EXPIRED', 410);

    let verified;
    try {
      verified = await deps.applink.verifyOtp({ referenceNo: session.referenceNo, otp: input.otp });
    } catch (err) {
      const mapped = mapApplinkError(err);
      if (mapped.code === 'OTP_EXPIRED') await deps.stores.otpSessions.consume(session.id, t);
      if (mapped.code === 'SERVICE_TROUBLE') {
        deps.log.warn(
          { statusCode: (err as { statusCode?: string }).statusCode },
          'otp verify failed',
        );
      }
      throw mapped;
    }

    await deps.stores.otpSessions.consume(session.id, t);

    // subscriberId and subscriptionStatus are stored exactly as returned and treated as opaque.
    const user = await deps.stores.users.upsertVerified({
      msisdn,
      accountType: input.accountType ?? 'INDIVIDUAL',
      subscriberId: verified.subscriberId ?? null,
      subscriptionStatus: verified.subscriptionStatus ?? null,
    });
    return issueSession(user);
  }

  async function issueSession(user: UserRecord): Promise<VerifiedSession> {
    const role: Role = user.accountType === 'PHARMACY' ? 'PHARMACY_OWNER' : 'FAMILY_ADMIN';
    const refresh = deps.tokens.newRefreshToken();
    await deps.stores.sessions.create({
      userId: user.id,
      refreshHash: refresh.hash,
      expiresAt: new Date(now().getTime() + REFRESH_TOKEN_TTL_MS),
    });
    const token = await deps.tokens.signAccess(
      { userId: user.id, role, isAdmin: user.isAdmin },
      now(),
    );
    return { user, role, token, refreshToken: refresh.token };
  }

  /** Rotates the refresh token. No Applink call: an expired access token must never cost a paid OTP. */
  async function refresh(refreshToken: string): Promise<{ token: string; refreshToken: string }> {
    const oldHash = hashRefreshToken(refreshToken);
    const t = now();
    const session = await deps.stores.sessions.findByRefreshHash(oldHash);
    if (!session || session.revokedAt !== null || session.expiresAt <= t) {
      throw new AuthError('INVALID_REFRESH', 401);
    }
    const user = await deps.stores.users.findById(session.userId);
    if (!user) throw new AuthError('INVALID_REFRESH', 401);

    const next = deps.tokens.newRefreshToken();
    const rotated = await deps.stores.sessions.rotate(
      session.id,
      oldHash,
      next.hash,
      new Date(t.getTime() + REFRESH_TOKEN_TTL_MS),
    );
    if (!rotated) throw new AuthError('INVALID_REFRESH', 401);

    const role: Role = user.accountType === 'PHARMACY' ? 'PHARMACY_OWNER' : 'FAMILY_ADMIN';
    const token = await deps.tokens.signAccess({ userId: user.id, role, isAdmin: user.isAdmin }, t);
    return { token, refreshToken: next.token };
  }

  async function logout(refreshToken: string): Promise<void> {
    const session = await deps.stores.sessions.findByRefreshHash(hashRefreshToken(refreshToken));
    if (session) await deps.stores.sessions.revoke(session.id, now());
  }

  return { requestOtp, verifyOtp, refresh, logout };
}

export type OtpService = ReturnType<typeof createOtpService>;
