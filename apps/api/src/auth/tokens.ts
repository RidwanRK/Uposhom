import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type Role = 'FAMILY_ADMIN' | 'PHARMACY_OWNER';

export interface AccessClaims {
  userId: string;
  role: Role;
  isAdmin: boolean;
}

/**
 * Access JWTs (15 minutes) and opaque rotating refresh tokens (90 days, stored hashed).
 * The token never carries the Applink subscriberId or the phone number.
 */
export function createTokenService(secret: string) {
  const key = new TextEncoder().encode(secret);

  return {
    async signAccess(claims: AccessClaims, now: Date = new Date()): Promise<string> {
      return new SignJWT({ role: claims.role, adm: claims.isAdmin })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setIssuedAt(Math.floor(now.getTime() / 1000))
        .setExpirationTime(Math.floor(now.getTime() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
        .sign(key);
    },

    /** Returns the claims, or null for anything invalid or expired. */
    async verifyAccess(token: string): Promise<AccessClaims | null> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        const role = payload['role'];
        if (!payload.sub || (role !== 'FAMILY_ADMIN' && role !== 'PHARMACY_OWNER')) return null;
        return { userId: payload.sub, role, isAdmin: payload['adm'] === true };
      } catch {
        return null;
      }
    },

    newRefreshToken(): { token: string; hash: string } {
      const token = randomBytes(32).toString('base64url');
      return { token, hash: hashRefreshToken(token) };
    },
  };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type TokenService = ReturnType<typeof createTokenService>;
