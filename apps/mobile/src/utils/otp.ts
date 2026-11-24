import { toLatinDigits } from './bangla';

/**
 * Applink's OTP service (sign-up, step-up before a sensitive action, Family Link) sends 5-digit
 * codes, for example 22436. Change it here if Applink ever changes it.
 */
export const OTP_LENGTH = 5;

/**
 * The payment code comes from a different Applink service (CaaS) whose length we have not seen
 * yet, so the payment sheet accepts what the server accepts: 4 to 8 digits.
 */
export const PAYMENT_OTP_MIN = 4;
export const PAYMENT_OTP_MAX = 8;

const digitsOnly = (input: string) => toLatinDigits(input).replace(/\D/g, '');

/** Digits only (Bangla digits become Latin), at most OTP_LENGTH. */
export function cleanOtp(input: string): string {
  return digitsOnly(input).slice(0, OTP_LENGTH);
}

/** True when the sign-up, step-up or Family Link code is complete. */
export function isOtpComplete(otp: string): boolean {
  return otp.length === OTP_LENGTH;
}

/** Digits only, at most PAYMENT_OTP_MAX. */
export function cleanPaymentOtp(input: string): string {
  return digitsOnly(input).slice(0, PAYMENT_OTP_MAX);
}

export function isPaymentOtpComplete(otp: string): boolean {
  return otp.length >= PAYMENT_OTP_MIN && otp.length <= PAYMENT_OTP_MAX;
}
