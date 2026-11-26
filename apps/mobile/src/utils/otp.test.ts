import { describe, expect, it } from 'vitest';
import { OTP_LENGTH, cleanOtp, cleanPaymentOtp, isOtpComplete, isPaymentOtpComplete } from './otp';

describe('OTP input', () => {
  it('takes Applink’s 5-digit code, from Latin or Bangla digits', () => {
    expect(OTP_LENGTH).toBe(5);
    expect(cleanOtp('22436')).toBe('22436');
    expect(cleanOtp('২২৪৩৬')).toBe('22436');
    expect(cleanOtp('224 36')).toBe('22436');
    expect(cleanOtp('2243699')).toBe('22436'); // never more than five
  });

  it('enables verify only at exactly five digits', () => {
    expect(isOtpComplete('2243')).toBe(false);
    expect(isOtpComplete('22436')).toBe(true);
    expect(isOtpComplete('')).toBe(false);
  });

  it('keeps the payment code flexible (4 to 8 digits) until its length is known', () => {
    expect(cleanPaymentOtp('1234567890')).toBe('12345678');
    expect(isPaymentOtpComplete('123')).toBe(false);
    expect(isPaymentOtpComplete('1234')).toBe(true);
    expect(isPaymentOtpComplete('123456')).toBe(true);
  });
});
