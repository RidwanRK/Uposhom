import { describe, expect, it } from 'vitest';
import { checkRedFlag } from './redflag';

describe('red-flag keyword guard (on-device mirror)', () => {
  const flagged: [string, string][] = [
    ['বুকে তীব্র ব্যথা', 'CHEST_PAIN'],
    ['বুকের ডানপাশে তীব্র ব্যথা এবং নিঃশ্বাস নিতে কষ্ট হচ্ছে', 'CHEST_PAIN'],
    ['বুকে ব্যথা করছে', 'CHEST_PAIN'],
    ['শ্বাসকষ্ট হচ্ছে', 'BREATHING'],
    ['শ্বাস কষ্ট', 'BREATHING'],
    ['নিঃশ্বাস নিতে কষ্ট হচ্ছে', 'BREATHING'],
    ['অতিরিক্ত রক্তপাত হচ্ছে', 'BLEEDING'],
    ['প্রচুর রক্ত যাচ্ছে', 'BLEEDING'],
    ['স্ট্রোকের লক্ষণ', 'STROKE'],
    ['মুখ বেঁকে গেছে', 'STROKE'],
    ['কথা জড়িয়ে যাচ্ছে', 'STROKE'],
    ['I have chest pain', 'CHEST_PAIN'],
  ];

  it.each(flagged)('flags %s', (text, category) => {
    const r = checkRedFlag(text);
    expect(r.isRedFlag).toBe(true);
    expect(r.categories).toContain(category);
  });

  it('does not flag ordinary symptoms', () => {
    for (const text of ['দুইদিন ধরে জ্বর', 'মাথা ব্যথা', 'পেটে জ্বালাপোড়া', 'কাশি ও গলা ব্যথা', '']) {
      expect(checkRedFlag(text).isRedFlag).toBe(false);
    }
  });
});
