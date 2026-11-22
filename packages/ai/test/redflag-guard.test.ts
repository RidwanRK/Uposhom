import { describe, it, expect } from 'vitest';
import { checkRedFlagKeywords, checkRedFlags } from '../src/guards/redflag-guard.js';

describe('Deterministic Red-Flag Emergency Keyword Guard', () => {
  describe('Chest Pain / Cardiac Emergency Detection (100% Coverage)', () => {
    const chestPainInputs = [
      'আমার বাবার বুকে তীব্র ব্যথা করছে',
      'বুকের মাঝে চাপ দিয়ে ব্যথা হচ্ছে',
      'বুক চেপে আসছে এবং খুব কষ্ট হচ্ছে',
      'হঠাৎ বুক ধড়ফড় করছে এবং বুকে ভার লাগছে',
      'Severe chest pain radiating to left arm',
      'Patient is having acute angina and chest tightness',
      'মনে হয় হার্ট অ্যাটাক হয়েছে, বুকে প্রচণ্ড যন্ত্রণা',
      'হৃদরোগের ইতিহাস আছে এবং বুকে চাপ অনুভূত হচ্ছে',
    ];

    it.each(chestPainInputs)('should detect chest pain in: "%s"', (input) => {
      const result = checkRedFlagKeywords(input);
      expect(result.isEmergency).toBe(true);
      expect(result.category).toBe('CHEST_PAIN');
      expect(result.emergencyNumber).toBe('999');
      expect(result.immediateBanglaAlert).toContain('৯৯৯');
    });
  });

  describe('Severe Dyspnea / Breathing Difficulty Detection', () => {
    const dyspneaInputs = [
      'রোগীর তীব্র শ্বাসকষ্ট শুরু হয়েছে',
      'আমি শ্বাস নিতে পারছি না, দম আটকে আসছে',
      'দম বন্ধ হয়ে যাওয়ার মতো অনুভূতি হচ্ছে',
      'Severe dyspnea and shortness of breath',
      'Patient cannot breathe and is gasping for air',
      'হাঁপানি তীব্র আকার ধারণ করেছে, দম ফুরিয়ে আসছে',
    ];

    it.each(dyspneaInputs)('should detect severe dyspnea in: "%s"', (input) => {
      const result = checkRedFlagKeywords(input);
      expect(result.isEmergency).toBe(true);
      expect(result.category).toBe('SEVERE_DYSPNEA');
      expect(result.emergencyNumber).toBe('999');
    });
  });

  describe('Severe Bleeding Detection', () => {
    const bleedingInputs = [
      'অতিরিক্ত রক্তক্ষরণ হচ্ছে এবং বন্ধ হচ্ছে না',
      'রোগী কাশির সাথে তাজা রক্ত ফেলছে',
      'রক্ত বমি হচ্ছে',
      'পায়খানার সাথে তাজা রক্ত যাচ্ছে',
      'Severe bleeding from surgical wound',
      'Patient vomiting blood and uncontrolled bleeding',
    ];

    it.each(bleedingInputs)('should detect severe bleeding in: "%s"', (input) => {
      const result = checkRedFlagKeywords(input);
      expect(result.isEmergency).toBe(true);
      expect(result.category).toBe('SEVERE_BLEEDING');
      expect(result.emergencyNumber).toBe('999');
    });
  });

  describe('Stroke Signs Detection', () => {
    const strokeInputs = [
      'হঠাৎ মুখের এক পাশ বাঁকা হয়ে গেছে',
      'কথা জড়িয়ে যাচ্ছে এবং কথা বলতে পারছে না',
      'বাবার ডান হাত পা অবশ হয়ে গেছে, নড়াতে পারছে না',
      'Patient showing sudden facial droop and slurred speech',
      'One side paralysis and acute arm weakness',
      'শরীরের এক পাশ সম্পূর্ণ অসাড় হয়ে গেছে',
    ];

    it.each(strokeInputs)('should detect stroke signs in: "%s"', (input) => {
      const result = checkRedFlagKeywords(input);
      expect(result.isEmergency).toBe(true);
      expect(result.category).toBe('STROKE_SIGNS');
      expect(result.emergencyNumber).toBe('999');
    });
  });

  describe('Unconsciousness / Collapse Detection', () => {
    const collapseInputs = [
      'রোগী হঠাৎ জ্ঞান হারিয়েছে এবং অজ্ঞান হয়ে পড়েছে',
      'বেহুঁশ হয়ে মেঝেতে পড়ে গেছে',
      'Patient is unconscious and unresponsive',
      'হঠাৎ সংজ্ঞাহীন হয়ে গেছে',
    ];

    it.each(collapseInputs)('should detect collapse/unconsciousness in: "%s"', (input) => {
      const result = checkRedFlagKeywords(input);
      expect(result.isEmergency).toBe(true);
      expect(result.category).toBe('UNCONSCIOUS');
      expect(result.emergencyNumber).toBe('999');
    });
  });

  describe('Non-Emergency Safe Inputs (Zero False Positives)', () => {
    const safeInputs = [
      'আজকের সকালের ওষুধ কখন খাব?',
      'নাপা ৫০০ মিলিগ্রাম দিনে কয়বার খেতে হবে?',
      'হালকা জ্বর ও সর্দি আছে',
      'আমার প্রেসক্রিপশনের বিকল্প ওষুধের নাম জানতে চাই',
      'কালকে ডাক্তারের অ্যাপয়েন্টমেন্ট আছে',
      'What is my next scheduled dose?',
      '',
    ];

    it.each(safeInputs)('should NOT trigger emergency alert for: "%s"', (input) => {
      const result = checkRedFlags(input);
      expect(result.isEmergency).toBe(false);
      expect(result.category).toBeUndefined();
    });
  });
});
