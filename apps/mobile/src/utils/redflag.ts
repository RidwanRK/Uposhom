/**
 * On-device mirror of the server's deterministic red-flag keyword guard (packages/ai
 * guards/redflag-guard.ts). The server stays the authority and runs before any model call; this copy
 * only makes sure the 999 modal still appears when the phone is offline or the request is slow.
 * It is a plain keyword match: no AI, no network.
 */
export type RedFlagCategory = 'CHEST_PAIN' | 'BREATHING' | 'BLEEDING' | 'STROKE';

const SOURCE: Record<RedFlagCategory, RegExp[]> = {
  CHEST_PAIN: [/বুক(?:ে|ের)?[^\n।]{0,20}ব্যথা/, /chest\s*pain/i, /heart\s*attack/i, /হার্ট\s*অ্যাটাক/],
  BREATHING: [
    /শ্বাস\s*কষ্ট/,
    /(?:নিঃশ্বাস|নিশ্বাস|শ্বাস)\s*(?:নিতে|ফেলতে)\s*(?:খুব\s*)?কষ্ট/,
    /দম\s*(?:বন্ধ|আটকে)/,
    /breath(?:ing)?\s*(?:difficulty|problem)|can'?t\s*breathe|short(?:ness)?\s*of\s*breath/i,
  ],
  BLEEDING: [
    /অতিরিক্ত\s*রক্ত(?:পাত|ক্ষরণ)/,
    /প্রচুর\s*রক্ত/,
    /রক্ত\s*(?:বন্ধ|থামছে)\s*না/,
    /রক্তপাত/,
    /severe\s*bleeding/i,
  ],
  STROKE: [
    /স্ট্রোক/,
    /মুখ\s*(?:বেঁকে|বাঁকা|বেকে)/,
    /কথা\s*জড়িয়ে/,
    /(?:এক\s*পাশ|একপাশ)[^\n।]{0,10}অবশ/,
    /stroke/i,
  ],
};

/** Bangla য় ড় ঢ় can be typed as one letter or as a base letter plus nukta. Make both forms equal. */
function unifyLetters(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‌‍]/g, '')
    .replace(/য়/g, 'য়')
    .replace(/ড়/g, 'ড়')
    .replace(/ঢ়/g, 'ঢ়');
}

function normalise(text: string): string {
  return unifyLetters(text).replace(/\s+/g, ' ');
}

// The patterns above are written by hand, so run them through the same letter unification.
const PATTERNS = Object.fromEntries(
  (Object.keys(SOURCE) as RedFlagCategory[]).map((c) => [
    c,
    SOURCE[c].map((re) => new RegExp(unifyLetters(re.source), re.flags)),
  ]),
) as Record<RedFlagCategory, RegExp[]>;

export function checkRedFlag(text: string): { isRedFlag: boolean; categories: RedFlagCategory[] } {
  const t = normalise(text);
  const categories = (Object.keys(PATTERNS) as RedFlagCategory[]).filter((c) =>
    PATTERNS[c].some((re) => re.test(t)),
  );
  return { isRedFlag: categories.length > 0, categories };
}

export const EMERGENCY_MESSAGE =
  'সতর্কতা: এটি একটি জরুরি স্বাস্থ্য পরিস্থিতি হতে পারে। অবিলম্বে নিকটস্থ জরুরি বিভাগে যোগাযোগ করুন।';
