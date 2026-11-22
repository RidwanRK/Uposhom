/**
 * Deterministic Red-Flag Emergency Guard
 *
 * CRITICAL SAFETY REQUIREMENT (Master Plan Section 6 & 7):
 * Symptom inputs with chest pain, severe breathing difficulty, severe bleeding,
 * or stroke signs immediately route to the 999 alert.
 *
 * This keyword guard runs FIRST, DETERMINISTICALLY, BEFORE ANY MODEL CALL.
 * It contains zero LLM guesswork, executes synchronously in sub-millisecond time,
 * and handles both Bangla and English medical and colloquial expressions.
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
  keywords: string[];
  banglaAlert: string;
}

const RED_FLAG_RULES: RedFlagRule[] = [
  {
    category: 'CHEST_PAIN',
    keywords: [
      'বুকে ব্যথা',
      'বুকে চাপ',
      'বুকে তীব্র চাপ',
      'বুকে জ্বালা',
      'বুক চেপে আসছে',
      'বুকে ভার',
      'বুক ধড়ফড়',
      'হৃদরোগ',
      'হার্ট অ্যাটাক',
      'হার্ট এটাক',
      'chest pain',
      'chest pressure',
      'angina',
      'heart attack',
      'myocardial infarction',
    ],
    banglaAlert:
      '🚨 জরুরি সতর্কবার্তা: বুকে তীব্র ব্যথা বা চাপ হৃদরোগ বা হার্ট অ্যাটাকের লক্ষণ হতে পারে! অবিলম্বে ৯৯৯ এ কল করুন অথবা নিকটস্থ হাসপাতালের জরুরি বিভাগে যোগাযোগ করুন। নিজে গাড়ি চালাবেন না।',
  },
  {
    category: 'SEVERE_DYSPNEA',
    keywords: [
      'তীব্র শ্বাসকষ্ট',
      'শ্বাসকষ্ট',
      'শ্বাস নিতে পারছি না',
      'দম বন্ধ',
      'দম আটকে আসছে',
      'হাঁপানি আক্রমণ',
      'শ্বাস নিতে কষ্ট',
      'দম ফেলতে পারছি না',
      'নীল হয়ে যাচ্ছে',
      'severe dyspnea',
      'shortness of breath',
      'cannot breathe',
      'asthma attack',
      'stridor',
      'choking',
    ],
    banglaAlert:
      '🚨 জরুরি সতর্কবার্তা: তীব্র শ্বাসকষ্ট বা দম আটকে আসা জরুরি পরিস্থিতি! কোনো বিলম্ব না করে ৯৯৯ এ অ্যাম্বুলেন্স ডাকুন অথবা নিকটস্থ জরুরি ক্লিনিকে রোগীকে নিয়ে যান। রোগীকে সোজা করে বসিয়ে রাখুন।',
  },
  {
    category: 'SEVERE_BLEEDING',
    keywords: [
      'অতিরিক্ত রক্তক্ষরণ',
      'প্রচুর রক্তপাত',
      'রক্ত বমি',
      'রক্তের বমি',
      'পায়খানার সাথে তাজা রক্ত',
      'রক্ত পড়া থামছে না',
      'রক্তপাত বন্ধ হচ্ছে না',
      'কাটা দিয়ে রক্ত ছুটছে',
      'severe bleeding',
      'massive bleeding',
      'heavy bleeding',
      'hematemesis',
      'uncontrolled bleeding',
      'hemorrhage',
    ],
    banglaAlert:
      '🚨 জরুরি সতর্কবার্তা: অতিরিক্ত রক্তক্ষরণ দ্রুত শকের কারণ হতে পারে! রক্তপাতের স্থানে পরিষ্কার কাপড় দিয়ে শক্ত করে চেপে ধরুন এবং অবিলম্বে ৯৯৯ এ কল করে জরুরি চিকিৎসাসেবা নিন।',
  },
  {
    category: 'STROKE_SIGNS',
    keywords: [
      'প্যারালাইসিস',
      'মুখ বাঁকা',
      'মুখ বেঁকে গেছে',
      'কথা জড়িয়ে যাচ্ছে',
      'কথা বলতে পারছে না',
      'এক পাশ অবশ',
      'হাত পা অবশ',
      'হাতের শক্তি নেই',
      'অসাড় হয়ে গেছে',
      'stroke',
      'slurred speech',
      'facial drooping',
      'face drooping',
      'arm weakness',
      'hemiplegia',
    ],
    banglaAlert:
      '🚨 জরুরি সতর্কবার্তা: মুখ বেঁকে যাওয়া, হাত অবশ হওয়া বা কথা জড়িয়ে যাওয়া স্ট্রোকের লক্ষণ! স্ট্রোকের ক্ষেত্রে প্রতি মিনিট গুরুত্বপূর্ণ। তাৎক্ষণিকভাবে ৯৯৯ এ ফোন করুন অথবা নিকটস্থ নিউরোলজি/জরুরি হাসপাতালে পৌঁছান।',
  },
  {
    category: 'UNCONSCIOUS',
    keywords: [
      'অজ্ঞান',
      'বেহুঁশ',
      'সংজ্ঞাহীন',
      'জ্ঞান হারিয়েছে',
      'সাড়াশব্দ নেই',
      'চোখ উল্টে গেছে',
      'খিঁচুনি দিয়ে অজ্ঞান',
      'unconscious',
      'collapsed',
      'fainted',
      'unresponsive',
      'loss of consciousness',
    ],
    banglaAlert:
      '🚨 জরুরি সতর্কবার্তা: রোগী সংজ্ঞাহীন বা অজ্ঞান! রোগীকে একপাশে কাত করে শুইয়ে দিন যাতে শ্বাসপথ খোলা থাকে। অবিলম্বে ৯৯৯ নম্বরে ফোন দিয়ে অ্যাম্বুলেন্স ডাকুন।',
  },
];

/**
 * Deterministically checks input text for life-threatening medical emergencies.
 * Runs instantly before any LLM processing.
 */
export function checkRedFlags(inputText: string): RedFlagCheckResult {
  if (!inputText || typeof inputText !== 'string') {
    return { isEmergency: false, emergencyNumber: '999' };
  }

  const normalized = inputText.toLowerCase().trim();

  for (const rule of RED_FLAG_RULES) {
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return {
          isEmergency: true,
          category: rule.category,
          matchedKeyword: keyword,
          emergencyNumber: '999',
          immediateBanglaAlert: rule.banglaAlert,
        };
      }
    }
  }

  return {
    isEmergency: false,
    emergencyNumber: '999',
  };
}
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
