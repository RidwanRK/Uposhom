import { toLatinDigits } from './bangla';

/**
 * Applink does not publish a fixed OTP length (its samples are 6 digits), and the server accepts
 * 4 to 8 digits on every code it checks (sign-up, step-up, Family Link, payments). The app accepts
 * the same, so a shorter or longer real code never leaves the verify button disabled.
 */
export const OTP_MIN_DIGITS = 4;
export const OTP_MAX_DIGITS = 8;

/** Keeps digits only (Bangla digits become Latin), at most OTP_MAX_DIGITS. */
export function cleanOtp(input: string): string {
  return toLatinDigits(input).replace(/\D/g, '').slice(0, OTP_MAX_DIGITS);
}

/** True when the code is long enough to send. */
export function isOtpComplete(otp: string): boolean {
  return otp.length >= OTP_MIN_DIGITS && otp.length <= OTP_MAX_DIGITS;
}
