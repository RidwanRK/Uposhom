import {
  ApplinkError,
  maskAddress,
  normalizeBdMsisdn,
  type ApplinkClient,
} from '@uposhom/applink-client';
import { ApiError } from '../errors.js';
import type { AccountType, OtpPurpose, Stores, UserRecord } from '../stores/types.js';
import { REFRESH_TOKEN_TTL_MS, hashRefreshToken, type Role, type TokenService } from './tokens.js';

export const OTP_VALIDITY_SECONDS = 300; // Applink OTPs are valid five minutes
export const MAX_VERIFY_ATTEMPTS = 5;

/** OTP requests are paid SMS: without these limits the endpoint is an SMS-bombing tool. */
export const LIMITS = {
  perNumber: { limit: 3, windowMs: 10 * 60 * 1000 },
  perNumberDaily: { limit: 10, windowMs: 24 * 60 * 60 * 1000 },
  perIp: { limit: 10, windowMs: 10 * 60 * 1000 },
} as const;

/** Kept as an alias: the OTP flow predates the shared ApiError. */
export const AuthError = ApiError;
export type AuthError = ApiError;

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
  /**
   * Normalised numbers that hold the admin flag (ADMIN_MSISDNS). Applied at OTP sign-in. Undefined
   * leaves the flag as it is in the database.
   */
  adminMsisdns?: ReadonlySet<string>;
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

  /** Rate limits, consent (sign-up only), Applink request, and the stored session. */
  async function sendOtp(
    msisdn: string,
    ip: string,
    purpose: OtpPurpose,
    familyLink?: { userId: string; profileId: string },
  ): Promise<{ maskedPhone: string; expiresInSeconds: number }> {
    if (!deps.applink) throw new AuthError('SERVICE_TROUBLE', 503);

    const t = now();
    const checks = [
      [`otp:num:${msisdn}`, LIMITS.perNumber],
      [`otp:day:${msisdn}`, LIMITS.perNumberDaily],
      [`otp:ip:${ip}`, LIMITS.perIp],
    ] as const;
    for (const [key, rule] of checks) {
      const res = await deps.stores.rateLimit.hit(key, rule.limit, rule.windowMs, t);
      if (!res.allowed) throw new AuthError('RATE_LIMITED', 429, res.retryAfterSeconds);
    }

    // The consent row is written before the request: verify activates an Applink subscription,
    // and the screen that precedes this call discloses that (Master Plan section 8). A step-up
    // code only re-proves a number that already consented.
    if (purpose === 'SIGNUP') {
      await deps.stores.consents.record({ msisdn, kind: 'SIGNUP_OTP_V1', channel: 'APP', ip }, t);
    }
    // Family Link verify activates an Applink subscription for the DEPENDENT's number, so their
    // consent is recorded against their profile before the code goes out. The admin who asked is
    // kept as the user who showed them the disclosure.
    if (purpose === 'FAMILY_LINK' && familyLink) {
      await deps.stores.consents.record(
        {
          msisdn,
          userId: familyLink.userId,
          profileId: familyLink.profileId,
          kind: 'FAMILY_LINK_OTP_V1',
          channel: 'APP',
          ip,
        },
        t,
      );
    }

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
      purpose,
      referenceNo,
      expiresAt: new Date(t.getTime() + OTP_VALIDITY_SECONDS * 1000),
      ...(familyLink ? { context: familyLink.profileId } : {}),
    });
    return { maskedPhone: maskMsisdn(msisdn), expiresInSeconds: OTP_VALIDITY_SECONDS };
  }

  /** Attempt cap, expiry, the Applink verify call, error mapping. Returns what Applink answered. */
  async function checkOtp(msisdn: string, otp: string, purpose: OtpPurpose, context?: string) {
    if (!deps.applink) throw new AuthError('SERVICE_TROUBLE', 503);

    const t = now();
    const session = await deps.stores.otpSessions.findOpen(msisdn, t);
    // A code requested for one purpose (or one profile) can never be spent on another.
    if (
      !session ||
      session.purpose !== purpose ||
      (context !== undefined && session.context !== context) ||
      session.attempts >= MAX_VERIFY_ATTEMPTS
    ) {
      throw new AuthError('OTP_EXPIRED', 410);
    }
    // Count the attempt before calling Applink, so a crash cannot grant a free retry.
    const attempts = await deps.stores.otpSessions.incrementAttempts(session.id);
    if (attempts > MAX_VERIFY_ATTEMPTS) throw new AuthError('OTP_EXPIRED', 410);

    let verified;
    try {
      verified = await deps.applink.verifyOtp({ referenceNo: session.referenceNo, otp });
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
    return verified;
  }

  async function requestOtp(input: { msisdn: string; ip: string }): Promise<{
    maskedPhone: string;
    expiresInSeconds: number;
  }> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn) throw new AuthError('NUMBER_NOT_ACCEPTED', 422);
    return sendOtp(msisdn, input.ip, 'SIGNUP');
  }

  async function verifyOtp(input: {
    msisdn: string;
    otp: string;
    accountType?: AccountType | undefined;
  }): Promise<VerifiedSession> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn || !/^\d{4,8}$/.test(input.otp)) throw new AuthError('INVALID_INPUT', 400);

    const verified = await checkOtp(msisdn, input.otp, 'SIGNUP');

    // subscriberId and subscriptionStatus are stored exactly as returned and treated as opaque.
    let user = await deps.stores.users.upsertVerified({
      msisdn,
      accountType: input.accountType ?? 'INDIVIDUAL',
      subscriberId: verified.subscriberId ?? null,
      subscriptionStatus: verified.subscriptionStatus ?? null,
    });
    // The admin flag follows ADMIN_MSISDNS when it is configured. Only an OTP-verified number can
    // pick it up, and the token carries it, so it changes at the next sign-in.
    if (deps.adminMsisdns) {
      const isAdmin = deps.adminMsisdns.has(msisdn);
      if (isAdmin !== user.isAdmin) {
        await deps.stores.users.setAdmin(user.id, isAdmin);
        user = { ...user, isAdmin };
      }
    }
    return issueSession(user);
  }

  /** A fresh code for the signed-in user's own number, before a sensitive action. */
  async function requestStepUp(input: { userId: string; ip: string }) {
    const user = await deps.stores.users.findById(input.userId);
    if (!user) throw new AuthError('INVALID_REFRESH', 401);
    return sendOtp(user.msisdn, input.ip, 'STEP_UP');
  }

  /** Proves the person holding the phone is the signed-in user. Returns a five-minute token. */
  async function verifyStepUp(input: { userId: string; otp: string }): Promise<string> {
    if (!/^\d{4,8}$/.test(input.otp)) throw new AuthError('INVALID_INPUT', 400);
    const user = await deps.stores.users.findById(input.userId);
    if (!user) throw new AuthError('INVALID_REFRESH', 401);
    const verified = await checkOtp(user.msisdn, input.otp, 'STEP_UP');
    // Whoever answered must be the subscriber we know. A different id means a different person.
    if (user.subscriberId && verified.subscriberId && verified.subscriberId !== user.subscriberId) {
      throw new AuthError('OTP_WRONG', 401);
    }
    return deps.tokens.signStepUp(user.id, now());
  }

  /**
   * Family Link, step 1: a code to the dependent's own phone. The caller (the domain service) has
   * already checked that the signed-in user administers the profile.
   */
  async function requestFamilyLink(input: {
    msisdn: string;
    ip: string;
    userId: string;
    profileId: string;
  }): Promise<{ maskedPhone: string; expiresInSeconds: number }> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn) throw new AuthError('NUMBER_NOT_ACCEPTED', 422);
    return sendOtp(msisdn, input.ip, 'FAMILY_LINK', {
      userId: input.userId,
      profileId: input.profileId,
    });
  }

  /**
   * Family Link, step 2: the dependent's code. Returns the subscriber id exactly as Applink gave it
   * (opaque, never shown to the app), for the domain service to store on the profile.
   */
  async function verifyFamilyLink(input: {
    msisdn: string;
    otp: string;
    profileId: string;
  }): Promise<{ msisdn: string; subscriberId: string | null }> {
    const msisdn = normalizeBdMsisdn(input.msisdn);
    if (!msisdn || !/^\d{4,8}$/.test(input.otp)) throw new AuthError('INVALID_INPUT', 400);
    const verified = await checkOtp(msisdn, input.otp, 'FAMILY_LINK', input.profileId);
    return { msisdn, subscriberId: verified.subscriberId ?? null };
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

  return {
    requestOtp,
    verifyOtp,
    requestStepUp,
    verifyStepUp,
    requestFamilyLink,
    verifyFamilyLink,
    refresh,
    logout,
  };
}

export type OtpService = ReturnType<typeof createOtpService>;
