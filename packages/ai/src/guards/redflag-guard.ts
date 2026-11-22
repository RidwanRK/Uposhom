/**
 * Deterministic Red-Flag Emergency Keyword Interceptor
 *
 * Safety requirement: Symptom inputs with chest pain, severe breathing difficulty,
 * severe bleeding, or stroke signs immediately route to the 999 emergency alert.
 * This runs 100% deterministically BEFORE any LLM call to guarantee instant,
 * zero-latency triage and protect patient life.
 */

export type EmergencyCategory =
  | 'CHEST_PAIN'
  | 'SEVERE_DYSPNEA'
  | 'SEVERE_BLEEDING'
  | 'STROKE_SIGNS'
  | 'UNCONSCIOUS';

export interface RedFlagCheckResult {
  isEmergency: boolean;
  category?: EmergencyCategory;
  matchedKeyword?: string;
  emergencyNumber: '999';
  immediateBanglaAlert?: string;
}

interface RedFlagRule {
  category: EmergencyCategory;
  patterns: RegExp[];
  alertMessageBn: string;
}

const RED_FLAG_RULES: RedFlagRule[] = [
  {
    category: 'CHEST_PAIN',
    patterns: [
      /(বুক|বুকে|বুকের).*(ব্যথা|বেথা|চাপ|ভার|জ্বালা|ধড়ফড়|যন্ত্রণা|চেপে)/i,
      /(হার্ট\s*অ্যাটাক|হার্ট\s*এটাক|হৃদরোগ)/i,
      /(chest).*(pain|pressure|tightness|heaviness|discomfort)/i,
      /(angina|heart\s*attack|myocardial\s*infarction)/i,
    ],
    alertMessageBn:
      'জরুরি সতর্কতা: আপনার উল্লেখিত লক্ষণটি (বুকে ব্যথা/চাপ) হৃদরোগ বা হার্ট অ্যাটাকের পূর্বলক্ষণ হতে পারে। এক মুহূর্তও দেরি না করে অবিলম্বে জাতীয় জরুরি সেবা ৯৯৯ এ কল করুন অথবা নিকটস্থ হাসপাতালের জরুরি বিভাগে যান।',
  },
  {
    category: 'SEVERE_DYSPNEA',
    patterns: [
      /(শ্বাস|দম).*(কষ্ট|বন্ধ|আটকে|ফুরিয়ে|নিতে পারছি না|নিতে কষ্ট)/i,
      /তীব্র\s*শ্বাসকষ্ট/i,
      /হাঁপানি\s*তীব্র/i,
      /(severe|acute).*(breathing difficulty|shortness of breath|dyspnea)/i,
      /(cannot|can't|unable to)\s*breathe/i,
      /(shortness\s*of\s*breath|gasping\s*for\s*air|stridor|choking)/i,
    ],
    alertMessageBn:
      'জরুরি সতর্কতা: তীব্র শ্বাসকষ্ট বা অক্সিজেন স্বল্পতা জীবনের জন্য মারাত্মক ঝুঁকিপূর্ণ। অবিলম্বে ৯৯৯ এ ডায়াল করে অ্যাম্বুলেন্স ডাকুন অথবা নিকটস্থ জরুরি ক্লিনিকে যান। রোগীকে সোজা করে বসিয়ে পর্যাপ্ত বাতাস দিন।',
  },
  {
    category: 'SEVERE_BLEEDING',
    patterns: [
      /(অতিরিক্ত|প্রচুর|তাজা).*(রক্তক্ষরণ|রক্তপাত|রক্ত)/i,
      /রক্ত\s*(বমি|পড়া|ক্ষরণ)/i,
      /(কাশির|পায়খানার|মলের|বমির).*(সাথে|সহ).*(তাজা\s*)?রক্ত/i,
      /(severe|massive|uncontrolled)\s*bleeding/i,
      /(vomiting\s*blood|coughing\s*blood|hematemesis|hemorrhage)/i,
    ],
    alertMessageBn:
      'জরুরি সতর্কতা: অতিরিক্ত রক্তক্ষরণ অবিলম্বে বন্ধ করা এবং রক্তের সঞ্চালন স্বাভাবিক রাখা অত্যন্ত জরুরি। রক্তপাতের স্থানে পরিষ্কার কাপড় চেপে ধরে অবিলম্বে ৯৯৯ এ কল করুন এবং রোগীকে দ্রুত জরুরি বিভাগে নিয়ে যান।',
  },
  {
    category: 'STROKE_SIGNS',
    patterns: [
      /(মুখ|মুখের|এক\s*পাশ|হাত|পা|শরীর).*(বাঁকা|বেঁকে|অবশ|প্যারালাইসিস|অসাড়)/i,
      /কথা\s*(জড়িয়ে|বলতে\s*পারছে\s*না)/i,
      /প্যারালাইসিস/i,
      /(stroke|facial\s*droop|slurred\s*speech|hemiplegia|paralysis)/i,
      /(sudden\s*numbness|arm\s*weakness|one\s*side\s*weakness)/i,
    ],
    alertMessageBn:
      'জরুরি সতর্কতা: মুখ বাঁকা হয়ে যাওয়া, এক পাশ অবশ হওয়া বা কথা জড়িয়ে যাওয়া স্ট্রোকের (Stroke) সুস্পষ্ট লক্ষণ। প্রতি মিনিট অত্যন্ত মূল্যবান। তৎক্ষণাৎ রোগীকে শুইয়ে দিন এবং অবিলম্বে ৯৯৯ এ কল করে নিকটস্থ স্ট্রোক সেন্টারে নিয়ে যান।',
  },
  {
    category: 'UNCONSCIOUS',
    patterns: [
      /(জ্ঞান\s*হারিয়ে|অজ্ঞান|বেহুঁশ|সংজ্ঞাহীন|চোখ\s*উল্টে)/i,
      /(unconscious|passed\s*out|fainted|unresponsive|loss\s*of\s*consciousness|collapsed)/i,
    ],
    alertMessageBn:
      'জরুরি সতর্কতা: রোগী জ্ঞান হারিয়েছেন বা সংজ্ঞাহীন। অবিলম্বে রোগীর শ্বাস ও পালস পরীক্ষা করুন এবং তাৎক্ষণিক ৯৯৯ নম্বরে ফোন দিয়ে দ্রুততম সময়ে জরুরি হাসপাতালে পৌঁছান।',
  },
];

/**
 * Deterministically checks user input text for life-threatening red-flag keywords.
 * Returns immediately with emergency instruction if any match is found.
 */
export function checkRedFlagKeywords(inputText: string): RedFlagCheckResult {
  if (!inputText || typeof inputText !== 'string') {
    return { isEmergency: false, emergencyNumber: '999' };
  }

  const normalized = inputText.trim();

  for (const rule of RED_FLAG_RULES) {
    for (const pattern of rule.patterns) {
      const match = normalized.match(pattern);
      if (match) {
        return {
          isEmergency: true,
          category: rule.category,
          matchedKeyword: match[0],
          emergencyNumber: '999',
          immediateBanglaAlert: rule.alertMessageBn,
        };
      }
    }
  }

  return {
    isEmergency: false,
    emergencyNumber: '999',
  };
}

export const checkRedFlags = checkRedFlagKeywords;
