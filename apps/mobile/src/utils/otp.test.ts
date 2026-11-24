import { describe, expect, it } from 'vitest';
import { OTP_MAX_DIGITS, cleanOtp, isOtpComplete } from './otp';

describe('OTP input', () => {
  it('keeps digits only, turns Bangla digits Latin, and caps the length', () => {
    expect(cleanOtp('১২৩ ৪৫৬')).toBe('123456');
    expect(cleanOtp('12-34ab')).toBe('1234');
    expect(cleanOtp('1234567890')).toHaveLength(OTP_MAX_DIGITS);
  });

  it('enables verify for any code the server accepts (4 to 8 digits)', () => {
    expect(isOtpComplete('123')).toBe(false);
    expect(isOtpComplete('1234')).toBe(true);
    expect(isOtpComplete('123456')).toBe(true);
    expect(isOtpComplete('12345678')).toBe(true);
    expect(isOtpComplete('')).toBe(false);
  });
});
