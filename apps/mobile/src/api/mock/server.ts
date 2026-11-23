/**
 * In-app MOCK of the Uposhom API (Master Plan section 16.3), so workstream D can build and demo every
 * screen before A, B and C ship the live endpoints. It returns exactly the shapes in
 * packages/shared and is switched off by setting EXPO_PUBLIC_API_URL (see src/api/config.ts).
 *
 * Demo sign-ins (OTP is always 123456):
 *   any valid number           new Family account, Free tier, one profile
 *   01700000099                demo admin: Premium, 3 profiles, alerts, agent traces
 *   numbers ending 1111        "number not accepted" (E1317)
 *   numbers ending 9999        "number blocked" (E1342)
 *   numbers ending 0000        "not on the test list" (E1343)
 *   numbers ending 5555        "service trouble" (E1603)
 *
 * IMPORTANT: the dose generation below stands in for packages/schedule-engine, which runs on the
 * server only. The real app never computes doses.
 */
import type {
  AlertItem,
  ConfirmItem,
  Dose,
  DoctorSummary,
  Profile,
  StockStatus,
  StoreProfile,
} from '@uposhom/shared';
import { dhakaDateKey, dhakaParts, formatTimeBn } from '../../utils/dates';
import { checkRedFlag, EMERGENCY_MESSAGE } from '../../utils/redflag';
import { toBn } from '../../utils/bangla';
import type { UploadFile } from '../client';
import {
  BN_ALIASES,
  DRUGS,
  FOLLOW_UP_QUESTIONS,
  PATTERNS,
  PHARMACIES,
  REPORTS,
  TIMELINE,
  TRACES,
} from './seed';

interface MockReq {
  method: string;
  path: string;
  query: Record<string, string | number | boolean | undefined>;
  body: unknown;
  upload?: { field: string; file: UploadFile; fields?: Record<string, string> };
  token: string | null;
  /** Live API in use: answer from one shared demo world (a live JWT is not a mock token). */
  hybrid?: boolean;
}
interface MockRes {
  status: number;
  json: unknown;
}

const DEMO_ADMIN = '01700000099';
const OTP = '123456';
const FREE_SCAN_LIMIT = 5;
const MIN = 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (json: unknown, status = 200): MockRes => ({ status, json });
const fail = (status: number, code: string, message?: string): MockRes => ({
  status,
  json: { success: false, error: { code, message } },
});

interface World {
  userId: string;
  msisdn: string;
  role: 'FAMILY_ADMIN' | 'PHARMACY_OWNER';
  isAdmin: boolean;
  circleId: string;
  tier: 'FREE' | 'PREMIUM';
  profiles: Profile[];
  doses: (Dose & { profileId: string })[];
  alerts: AlertItem[];
  sub: { status: 'INACTIVE' | 'PENDING' | 'ACTIVE' | 'CANCELLED'; pendingSince?: number };
  scans: number;
  scanCredits: number;
  summaryCredits: number;
  settings: { discreetSms: boolean; smsReminders: boolean };
  charges: Map<string, { purpose: string; status: string; verifiedAt?: number; attempts: number }>;
  journals: Map<string, { profileId: string; answers: string[]; first: string }>;
  summaries: Map<string, DoctorSummary>;
  pharmacyProfile: StoreProfile;
  stock: Map<string, { status: StockStatus; updatedAt: string }>;
  stepUp: boolean;
}

const worlds = new Map<string, World>();
let idSeq = 100;
const nid = (p: string) => `${p}_${idSeq++}`;

const MEAL_TIMES = { morning: '08:00', noon: '13:30', evening: '17:00', night: '20:30' };

function isoDhaka(dateKey: string, hhmm: string): string {
  return `${dateKey}T${hhmm}:00+06:00`;
}

function hhmmShift(hhmm: string, deltaMin: number): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function relationText(rel: MealRel): string {
  return rel === 'AC'
    ? 'খাবার ৩০ মিনিট পূর্বে'
    : rel === 'PC'
      ? 'খাবার পর'
      : rel === 'WITH_MEAL'
        ? 'খাবারের সাথে'
        : '';
}
type MealRel = ConfirmItem['mealRelation'];

function drugByName(name: string) {
  const n = name.toLowerCase().trim();
  return (
    DRUGS.find((d) => d.nameEn.toLowerCase() === n) ??
    DRUGS.find((d) => d.nameEn.toLowerCase().startsWith(n)) ??
    DRUGS.find((d) => n.startsWith(d.nameEn.toLowerCase()))
  );
}

function makeDose(
  profileId: string,
  dateKey: string,
  hhmm: string,
  medicine: string,
  meal: MealRel,
  critical: boolean,
  now: number,
): Dose & { profileId: string } {
  const drug = drugByName(medicine);
  const dueAt = isoDhaka(dateKey, hhmm);
  const past = new Date(dueAt).getTime() < now - 45 * MIN;
  return {
    id: nid('dose'),
    profileId,
    dueAt,
    medicine: drug
      ? /\d/.test(drug.nameEn)
        ? drug.nameEn
        : `${drug.nameEn} ${drug.strength}`
      : medicine,
    medicineBn: drug?.nameBn,
    strength: drug?.strength,
    form: drug?.form ?? 'Tablet',
    instructions: relationText(meal),
    mealRelation: meal,
    status: past ? 'TAKEN' : 'SCHEDULED',
    takenAt: past ? new Date(new Date(dueAt).getTime() - 5 * MIN).toISOString() : null,
    isCritical: critical,
  };
}

function seedDoses(profileId: string, who: 'self' | 'father' | 'mother', now: number) {
  const day = dhakaDateKey(now);
  const d = (hhmm: string, name: string, meal: MealRel, crit = false) =>
    makeDose(profileId, day, hhmm, name, meal, crit, now);
  if (who === 'father') {
    return [
      d('07:30', 'Seclo 20', 'AC'),
      d('08:00', 'Metformin 500', 'PC', true),
      d('13:30', 'Metformin 500', 'PC', true),
      d('13:30', 'Amlodipine 5', 'PC'),
      d('20:30', 'Metformin 500', 'PC', true),
      d('20:30', 'Atorvastatin 10', 'PC'),
    ];
  }
  if (who === 'mother') {
    return [d('08:30', 'Napa Extra', 'PC'), d('20:30', 'Napa Extra', 'PC')];
  }
  return [
    d('07:30', 'Seclo 20', 'AC'),
    d('08:30', 'Napa Extra', 'PC', true),
    d('13:30', 'Amlodipine 5', 'PC'),
    d('20:30', 'Napa Extra', 'PC', true),
  ];
}

function adherence(w: World, profileId: string, now: number): number | null {
  const due = w.doses.filter(
    (d) => d.profileId === profileId && new Date(d.dueAt).getTime() <= now,
  );
  if (due.length === 0) return null;
  const taken = due.filter((d) => d.status === 'TAKEN' || d.status === 'TAKEN_LATE').length;
  return Math.round((taken / due.length) * 1000) / 10;
}

function ensureWorld(msisdn: string, accountType?: 'INDIVIDUAL' | 'PHARMACY'): World {
  const existing = worlds.get(msisdn);
  if (existing) return existing;
  const now = Date.now();
  const isDemo = msisdn === DEMO_ADMIN;
  const userId = nid('usr');
  const selfId = nid('prf');
  const w: World = {
    userId,
    msisdn,
    role: accountType === 'PHARMACY' ? 'PHARMACY_OWNER' : 'FAMILY_ADMIN',
    isAdmin: isDemo,
    circleId: nid('cir'),
    tier: isDemo ? 'PREMIUM' : 'FREE',
    profiles: [],
    doses: [],
    alerts: [],
    sub: { status: isDemo ? 'ACTIVE' : 'INACTIVE' },
    scans: 3,
    scanCredits: 0,
    summaryCredits: 0,
    settings: { discreetSms: false, smsReminders: true },
    charges: new Map(),
    journals: new Map(),
    summaries: new Map(),
    pharmacyProfile: {
      name: 'আপনার ফার্মেসি',
      address: 'ধানমন্ডি ১৫, ঢাকা',
      phone: msisdn,
      openingHours: 'সকাল ০৯:০০ থেকে রাত ১০:০০',
      lat: 23.7461,
      lng: 90.3742,
      isPartner: false,
      priorityListing: false,
    },
    stock: new Map(
      DRUGS.slice(0, 10).map((d, i) => [
        d.id,
        {
          status: (i % 4 === 3 ? 'OUT_OF_STOCK' : 'IN_STOCK') as StockStatus,
          updatedAt: new Date(now - (i + 1) * 40 * MIN).toISOString(),
        },
      ]),
    ),
    stepUp: false,
  };

  w.profiles.push({
    id: selfId,
    name: isDemo ? 'আমি (সালমা)' : 'আমি',
    relationship: 'SELF',
    age: 34,
    avatar: '🙂',
    status: 'OK',
    allergies: '',
    mealTimes: { ...MEAL_TIMES },
    quietHours: { start: '22:00', end: '06:00' },
    phoneLinked: true,
    myRole: 'ADMIN',
    links: [{ id: nid('lnk'), userId, name: 'আমি', role: 'ADMIN' }],
  });
  if (w.role === 'FAMILY_ADMIN') w.doses.push(...seedDoses(selfId, 'self', now));

  if (isDemo) {
    const fatherId = nid('prf');
    const motherId = nid('prf');
    w.profiles.push(
      {
        id: fatherId,
        name: 'বাবা (আবুল কালাম)',
        relationship: 'FATHER',
        age: 68,
        avatar: '👴',
        status: 'MISSED_CRITICAL',
        allergies: 'পেনিসিলিন',
        mealTimes: { ...MEAL_TIMES, morning: '07:30' },
        quietHours: { start: '22:00', end: '06:00' },
        phoneLinked: true,
        myRole: 'ADMIN',
        links: [
          { id: nid('lnk'), userId: nid('usr'), name: 'বাবা', role: 'VIEWER' },
          { id: nid('lnk'), userId, name: 'আমি (সালমা)', role: 'ADMIN' },
          {
            id: nid('lnk'),
            userId: nid('usr'),
            name: 'ভাই (কামাল)',
            role: 'CAREGIVER',
            isSecondaryCaregiver: true,
          },
        ],
      },
      {
        id: motherId,
        name: 'মা (রহিমা বেগম)',
        relationship: 'MOTHER',
        age: 62,
        avatar: '👵',
        status: 'OK',
        allergies: '',
        mealTimes: { ...MEAL_TIMES },
        quietHours: { start: '22:00', end: '06:00' },
        phoneLinked: false,
        myRole: 'CAREGIVER',
        links: [{ id: nid('lnk'), userId, name: 'আমি (সালমা)', role: 'CAREGIVER' }],
      },
    );
    w.doses.push(...seedDoses(fatherId, 'father', now), ...seedDoses(motherId, 'mother', now));
    // Make the father's most recent past critical dose overdue so the escalation card and amber state show.
    const overdue = [...w.doses]
      .filter((d) => d.profileId === fatherId && d.isCritical && new Date(d.dueAt).getTime() < now)
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
    if (overdue) {
      overdue.status = 'SCHEDULED';
      overdue.takenAt = null;
      w.alerts.push({
        id: nid('alr'),
        type: 'MISSED_DOSE',
        createdAt: new Date(now - 20 * MIN).toISOString(),
        profileId: fatherId,
        profileName: 'বাবা (আবুল কালাম)',
        title: 'জরুরি ওষুধ মিস হয়েছে',
        doseId: overdue.id,
        medicine: overdue.medicine,
        dueAt: overdue.dueAt,
        overdueMinutes: Math.max(30, Math.round((now - new Date(overdue.dueAt).getTime()) / MIN)),
        callPhone: '01711000111',
        acknowledged: false,
      });
    }
    w.alerts.push(
      {
        id: nid('alr'),
        type: 'REFILL_DUE',
        createdAt: new Date(now - 5 * 60 * MIN).toISOString(),
        profileId: fatherId,
        profileName: 'বাবা (আবুল কালাম)',
        title: 'ওষুধ শেষ হয়ে আসছে',
        body: 'Metformin 500mg আর ২ দিনের মতো আছে। রিফিল করুন।',
        acknowledged: false,
      },
      {
        id: nid('alr'),
        type: 'FOLLOW_UP',
        createdAt: new Date(now - 24 * 60 * MIN).toISOString(),
        profileId: motherId,
        profileName: 'মা (রহিমা বেগম)',
        title: 'ফলো-আপ অ্যাপয়েন্টমেন্ট',
        body: 'ডাক্তারের সাথে দেখা করার তারিখ কাল।',
        acknowledged: false,
      },
      {
        id: nid('alr'),
        type: 'WEEKLY_DIGEST',
        createdAt: new Date(now - 48 * 60 * MIN).toISOString(),
        profileId: fatherId,
        profileName: 'বাবা (আবুল কালাম)',
        title: 'সাপ্তাহিক সারসংক্ষেপ',
        body: `এই সপ্তাহে বাবা ${toBn(92)}% ওষুধ সময়মতো খেয়েছেন।`,
        acknowledged: true,
        acknowledgedAt: new Date(now - 40 * 60 * MIN).toISOString(),
      },
      {
        id: nid('alr'),
        type: 'SMS_FAILURE',
        createdAt: new Date(now - 90 * MIN).toISOString(),
        profileId: fatherId,
        profileName: 'বাবা (আবুল কালাম)',
        title: 'এসএমএস পৌঁছায়নি',
        body: 'জরুরি ওষুধের এসএমএস বাবার ফোনে পৌঁছায়নি। ফোন করে জানান।',
        callPhone: '01711000111',
        acknowledged: false,
      },
    );
  } else {
    w.alerts.push({
      id: nid('alr'),
      type: 'REFILL_DUE',
      createdAt: new Date(now - 3 * 60 * MIN).toISOString(),
      profileId: selfId,
      profileName: 'আমি',
      title: 'ওষুধ শেষ হয়ে আসছে',
      body: 'Amlodipine 5mg আর ২ দিনের মতো আছে।',
      acknowledged: false,
    });
  }

  worlds.set(msisdn, w);
  return w;
}

function worldFor(token: string | null, hybrid?: boolean): World | null {
  if (hybrid) {
    const w = ensureWorld('hybrid-demo');
    // No quota gating in hybrid mode: the live server owns entitlements, the mock only fills screens.
    w.tier = 'PREMIUM';
    return w;
  }
  if (!token?.startsWith('mock.')) return null;
  const msisdn = token.split('.')[1] ?? '';
  return worlds.get(msisdn) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Handlers

type Handler = (req: MockReq, params: string[], w: World) => Promise<MockRes> | MockRes;
interface Route {
  method: string;
  re: RegExp;
  auth: boolean;
  handler: Handler;
}
const routes: Route[] = [];
const route = (method: string, pattern: string, auth: boolean, handler: Handler) =>
  routes.push({
    method,
    re: new RegExp(`^${pattern.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`),
    auth,
    handler,
  });

const bodyOf = <T>(req: MockReq) => (req.body ?? {}) as T;
const newest = (a: string, b: string) => b.localeCompare(a);

// ---- auth
const otpState = new Map<string, { sentAt: number }>();

route('POST', '/auth/otp/request', false, async (req) => {
  const { msisdn } = bodyOf<{ msisdn: string }>(req);
  if (!/^01[3-9]\d{8}$/.test(msisdn ?? '')) return fail(400, 'NUMBER_NOT_ACCEPTED');
  if (msisdn.endsWith('1111')) return fail(400, 'NUMBER_NOT_ACCEPTED');
  if (msisdn.endsWith('9999')) return fail(403, 'NUMBER_BLOCKED');
  if (msisdn.endsWith('0000')) return fail(403, 'NOT_ON_TEST_LIST');
  if (msisdn.endsWith('5555')) return fail(503, 'SERVICE_TROUBLE');
  await sleep(500);
  otpState.set(msisdn, { sentAt: Date.now() });
  return ok({
    success: true,
    maskedPhone: `${msisdn.slice(0, 3)}****${msisdn.slice(-4)}`,
    expiresInSeconds: 300,
  });
});

route('POST', '/auth/otp/verify', false, async (req) => {
  const { msisdn, otp, accountType } = bodyOf<{
    msisdn: string;
    otp: string;
    accountType?: 'INDIVIDUAL' | 'PHARMACY';
  }>(req);
  const st = otpState.get(msisdn);
  if (!st || Date.now() - st.sentAt > 5 * MIN) return fail(400, 'OTP_EXPIRED');
  if (otp !== OTP) return fail(400, 'OTP_WRONG');
  await sleep(400);
  otpState.delete(msisdn);
  const w = ensureWorld(msisdn, accountType);
  return ok({
    success: true,
    token: `mock.${msisdn}.access`,
    refreshToken: `mock.${msisdn}.refresh`,
    user: { id: w.userId, msisdn: `88${msisdn}`, role: w.role, isAdmin: w.isAdmin },
    circle: { id: w.circleId, tier: w.tier, memberCount: w.profiles.length },
  });
});

route('POST', '/auth/refresh', false, (req) => {
  const { refreshToken } = bodyOf<{ refreshToken: string }>(req);
  const m = /^mock\.(\d+)\.refresh$/.exec(refreshToken ?? '');
  if (!m?.[1] || !worlds.has(m[1])) return fail(401, 'UNAUTHORIZED');
  return ok({ token: `mock.${m[1]}.access`, refreshToken });
});
route('POST', '/auth/logout', true, () => ok({ success: true }));
route('POST', '/auth/step-up/request', true, async (_req, _p, w) => {
  await sleep(300);
  w.stepUp = false;
  return ok({ success: true });
});
route('POST', '/auth/step-up/verify', true, (req, _p, w) => {
  const { otp } = bodyOf<{ otp: string }>(req);
  if (otp !== OTP) return fail(400, 'OTP_WRONG');
  w.stepUp = true;
  return ok({ stepUpToken: `stepup.${w.userId}` });
});

// ---- circles
const maxProfiles = (w: World) => (w.tier === 'PREMIUM' ? 7 : 1);

route('GET', '/circles', true, (_req, _p, w) => {
  const now = Date.now();
  const profiles = w.profiles.map((p) => ({ ...p, adherenceRate: adherence(w, p.id, now) }));
  return ok({
    circle: {
      id: w.circleId,
      tier: w.tier,
      memberCount: w.profiles.length,
      maxProfiles: maxProfiles(w),
    },
    profiles,
  });
});

route('POST', '/profiles', true, (req, _p, w) => {
  if (w.profiles.length >= maxProfiles(w)) return fail(402, 'PAYMENT_REQUIRED', 'PREMIUM');
  const b = bodyOf<{
    name: string;
    age?: number;
    relationship: string;
    msisdn?: string;
    mealTimes?: Profile['mealTimes'];
  }>(req);
  const p: Profile = {
    id: nid('prf'),
    name: b.name,
    relationship: b.relationship,
    age: b.age ?? null,
    avatar:
      b.relationship === 'FATHER'
        ? '👴'
        : b.relationship === 'MOTHER'
          ? '👵'
          : b.relationship === 'DAUGHTER'
            ? '👧'
            : b.relationship === 'SON'
              ? '👦'
              : '🙂',
    status: 'OK',
    allergies: '',
    mealTimes: b.mealTimes ?? { ...MEAL_TIMES },
    quietHours: { start: '22:00', end: '06:00' },
    phoneLinked: false,
    myRole: 'ADMIN',
    links: [{ id: nid('lnk'), userId: w.userId, name: 'আমি', role: 'ADMIN' }],
  };
  w.profiles.push(p);
  return ok(p, 201);
});

route('PUT', '/profiles/:id', true, (req, [id], w) => {
  const p = w.profiles.find((x) => x.id === id);
  if (!p) return fail(404, 'NOT_FOUND');
  Object.assign(p, bodyOf<Partial<Profile>>(req));
  return ok(p);
});

route('POST', '/profiles/:id/link/request', true, async () => {
  await sleep(400);
  return ok({ success: true });
});
route('POST', '/profiles/:id/link/verify', true, (req, [id], w) => {
  const { otp } = bodyOf<{ otp: string }>(req);
  if (otp !== OTP) return fail(400, 'OTP_WRONG');
  const p = w.profiles.find((x) => x.id === id);
  if (p) p.phoneLinked = true;
  return ok({ success: true });
});
route('POST', '/links', true, (req, _p, w) => {
  const { profileId, role } = bodyOf<{ profileId: string; role: 'ADMIN' | 'CAREGIVER' | 'VIEWER' }>(
    req,
  );
  const p = w.profiles.find((x) => x.id === profileId);
  if (!p) return fail(404, 'NOT_FOUND');
  p.links = [...(p.links ?? []), { id: nid('lnk'), userId: nid('usr'), name: 'নতুন সদস্য', role }];
  return ok({ success: true });
});
route('PUT', '/links/:id', true, (req, [id], w) => {
  const { role } = bodyOf<{ role: 'ADMIN' | 'CAREGIVER' | 'VIEWER' }>(req);
  for (const p of w.profiles) for (const l of p.links ?? []) if (l.id === id) l.role = role;
  return ok({ success: true });
});
route('DELETE', '/links/:id', true, (_req, [id], w) => {
  if (!w.stepUp) return fail(403, 'STEP_UP_REQUIRED');
  for (const p of w.profiles) p.links = (p.links ?? []).filter((l) => l.id !== id);
  return ok({ success: true });
});
route('PUT', '/profiles/:id/secondary-caregiver', true, (req, [id], w) => {
  const { linkId } = bodyOf<{ linkId: string }>(req);
  const p = w.profiles.find((x) => x.id === id);
  for (const l of p?.links ?? []) l.isSecondaryCaregiver = l.id === linkId;
  return ok({ success: true });
});

route('POST', '/devices', true, () => ok({ success: true }));

// ---- prescriptions
const SAMPLE_ITEMS = [
  {
    tempId: 'tmp_1',
    brandName: 'Napa Extra',
    genericName: 'Paracetamol + Caffeine',
    strength: '500mg+65mg',
    form: 'Tablet',
    pattern: '1+0+1',
    mealRelation: 'PC' as const,
    durationDays: 5,
    confidence: 0.94,
    isCritical: false,
  },
  {
    tempId: 'tmp_2',
    brandName: 'Seclo',
    genericName: 'Omeprazole',
    strength: '20mg',
    form: 'Capsule',
    pattern: '1+0+0',
    mealRelation: 'AC' as const,
    durationDays: 14,
    confidence: 0.98,
    isCritical: false,
  },
  {
    tempId: 'tmp_3',
    brandName: 'Alatrol',
    genericName: 'Cetirizine',
    strength: '10mg',
    form: 'Tablet',
    pattern: '0+0+1',
    mealRelation: 'PC' as const,
    durationDays: 7,
    confidence: 0.82,
    isCritical: false,
  },
];

route('POST', '/prescriptions/upload-and-parse', true, async (_req, _p, w) => {
  if (w.tier === 'FREE' && w.scans >= FREE_SCAN_LIMIT) {
    if (w.scanCredits <= 0) return fail(402, 'PAYMENT_REQUIRED', 'SCAN');
    w.scanCredits -= 1;
  }
  await sleep(1800);
  w.scans += 1;
  return ok({
    draftPrescriptionId: nid('pre_draft'),
    transcribedText:
      'Tab Napa Extra 1+0+1 BDPC 5 days\nCap Seclo 20mg 1+0+0 30m AC 14 days\nTab Alatrol 10mg 0+0+1 PC 7 days',
    extractedItems: SAMPLE_ITEMS,
  });
});

const SLOT_ORDER3 = ['morning', 'noon', 'night'] as const;
const SLOT_ORDER4 = ['morning', 'noon', 'evening', 'night'] as const;

route('POST', '/prescriptions/:id/confirm', true, async (req, _p, w) => {
  const b = bodyOf<{ profileId: string; items: ConfirmItem[] }>(req);
  const profile = w.profiles.find((p) => p.id === b.profileId);
  if (!profile) return fail(404, 'NOT_FOUND');
  await sleep(700);
  const now = Date.now();
  const day = dhakaDateKey(now);
  let events = 0;
  let first: string | null = null;
  const phrases: string[] = [];
  for (const item of b.items) {
    const slots = item.parsedPattern === 'SOS' ? [] : item.parsedPattern.split('+');
    const order = slots.length === 4 ? SLOT_ORDER4 : SLOT_ORDER3;
    const perDay = slots.filter((s) => s !== '0').length;
    events += perDay * item.durationDays;
    const drug = drugByName(item.brandName);
    slots.forEach((s, i) => {
      if (s === '0') return;
      const anchor = profile.mealTimes[order[i] ?? 'morning'];
      const shift = item.mealRelation === 'AC' ? -30 : item.mealRelation === 'PC' ? 30 : 0;
      const hhmm = hhmmShift(anchor, shift);
      const dose = makeDose(
        b.profileId,
        day,
        hhmm,
        `${item.brandName} ${item.dosageStrength}`,
        item.mealRelation,
        item.isCritical,
        now,
      );
      dose.medicine = `${item.brandName} ${item.dosageStrength}`;
      if (drug) dose.medicineBn = drug.nameBn;
      dose.status = 'SCHEDULED';
      dose.takenAt = null;
      w.doses.push(dose);
      if (!first || dose.dueAt < first) first = dose.dueAt;
    });
    const name = drug?.nameBn ?? item.brandName;
    phrases.push(`${name} ${toBn(item.parsedPattern)} ${relationText(item.mealRelation)}`.trim());
  }
  return ok(
    {
      prescriptionId: nid('pre_confirmed'),
      status: 'CONFIRMED',
      scheduledEventsCount: events,
      firstDoseAt: first,
      banglaSummary: `আপনার প্রেসক্রিপশনের জন্য মোট ${toBn(b.items.length)}টি ওষুধ শিডিউল করা হয়েছে। ${phrases.join('; ')}।`,
    },
    201,
  );
});

// ---- doses
function overdueOf(d: Dose, now: number) {
  return d.status === 'SCHEDULED' && new Date(d.dueAt).getTime() < now;
}

route('GET', '/doses/today', true, (req, _p, w) => {
  const now = Date.now();
  const pid = (req.query.profileId as string | undefined) ?? w.profiles[0]?.id;
  const list = w.doses
    .filter((d) => d.profileId === pid)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return ok({
    date: dhakaDateKey(now),
    timezone: 'Asia/Dhaka',
    doses: list,
    adherenceRate: pid ? adherence(w, pid, now) : null,
  });
});

route('POST', '/doses/:id/action', true, async (req, [id], w) => {
  const d = w.doses.find((x) => x.id === id);
  if (!d) return fail(404, 'NOT_FOUND');
  const b = bodyOf<{ action: 'TAKEN' | 'SNOOZE' | 'SKIP'; snoozeMinutes?: number }>(req);
  const now = Date.now();
  if (b.action === 'TAKEN') {
    d.status =
      overdueOf(d, now) && now - new Date(d.dueAt).getTime() > 30 * MIN ? 'TAKEN_LATE' : 'TAKEN';
    d.takenAt = new Date(now).toISOString();
    for (const a of w.alerts) if (a.doseId === id) a.acknowledged = true;
  } else if (b.action === 'SNOOZE') {
    d.status = 'SNOOZED';
    d.dueAt = new Date(now + (b.snoozeMinutes ?? 15) * MIN).toISOString().replace('Z', '+00:00');
    const p = dhakaParts(d.dueAt);
    d.dueAt = isoDhaka(
      dhakaDateKey(d.dueAt),
      `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`,
    );
  } else {
    d.status = 'SKIPPED';
  }
  const profile = w.profiles.find((p) => p.id === d.profileId);
  if (
    profile &&
    w.doses.every((x) => x.profileId !== profile.id || !(x.isCritical && overdueOf(x, now)))
  )
    profile.status = 'OK';
  return ok({
    success: true,
    doseId: id,
    newStatus: d.status,
    updatedAdherenceRate: adherence(w, d.profileId, now),
  });
});

route('POST', '/doses/:id/acknowledge', true, (_req, [id], w) => {
  const a = w.alerts.find((x) => x.doseId === id);
  if (a) {
    a.acknowledged = true;
    a.acknowledgedAt = new Date().toISOString();
  }
  return ok({ success: true });
});

route('GET', '/alerts', true, (_req, _p, w) =>
  ok({ alerts: [...w.alerts].sort((a, b) => newest(a.createdAt, b.createdAt)) }),
);

// ---- symptoms and summaries
route('POST', '/symptoms/journal', true, async (req, _p, w) => {
  const b = bodyOf<{
    profileId: string;
    inputText: string;
    channel: 'TEXT' | 'VOICE';
    sessionId?: string;
    skip?: boolean;
  }>(req);
  const flag = checkRedFlag(b.inputText ?? '');
  if (flag.isRedFlag) {
    return ok({
      isRedFlag: true,
      alertMessage: EMERGENCY_MESSAGE,
      emergencyDial: 'tel:999',
      collectedSlots: { symptom: b.inputText, severity: 'CRITICAL' },
      doctorSummaryReady: false,
    });
  }
  await sleep(700);
  const sid = b.sessionId ?? nid('jrn');
  const j = w.journals.get(sid) ?? { profileId: b.profileId, answers: [], first: b.inputText };
  if (b.sessionId) j.answers.push(b.skip ? '' : b.inputText);
  w.journals.set(sid, j);
  const idx = j.answers.length;
  if (idx < FOLLOW_UP_QUESTIONS.length) {
    return ok({
      isRedFlag: false,
      doctorSummaryReady: false,
      sessionId: sid,
      nextQuestion: FOLLOW_UP_QUESTIONS[idx],
      questionIndex: idx + 1,
      questionTotal: FOLLOW_UP_QUESTIONS.length,
      collectedSlots: { symptom: j.first },
    });
  }
  const todayMeds = [
    ...new Set(w.doses.filter((d) => d.profileId === b.profileId).map((d) => d.medicine)),
  ];
  const summary: DoctorSummary = {
    id: nid('sum'),
    symptoms: j.first,
    onset: j.answers[0] || undefined,
    duration: j.answers[1] || undefined,
    severity: j.answers[2] || undefined,
    triggers: j.answers[3] || undefined,
    associated: j.answers[4] || undefined,
    currentMedicines: j.answers[5] ? [j.answers[5]] : todayMeds,
    recentPrescriptions: ['Seclo 20mg, Napa Extra (১৪ নভেম্বর)'],
    createdAt: new Date().toISOString(),
  };
  w.summaries.set(summary.id ?? sid, summary);
  return ok({
    isRedFlag: false,
    doctorSummaryReady: true,
    sessionId: sid,
    nextQuestion: null,
    summary,
    collectedSlots: { symptom: j.first },
  });
});

route('POST', '/summaries/doctor', true, (req, _p, w) => {
  const b = bodyOf<{ profileId: string; summaryId?: string }>(req);
  if (w.tier === 'FREE') {
    if (w.summaryCredits <= 0) return fail(402, 'PAYMENT_REQUIRED', 'DOCTOR_SUMMARY');
  }
  const summary = (b.summaryId ? w.summaries.get(b.summaryId) : undefined) ??
    [...w.summaries.values()].pop() ?? {
      symptoms: 'কোনো সাম্প্রতিক লক্ষণ নেই',
      currentMedicines: [
        ...new Set(w.doses.filter((d) => d.profileId === b.profileId).map((d) => d.medicine)),
      ],
      recentPrescriptions: ['Seclo 20mg, Napa Extra (১৪ নভেম্বর)'],
      createdAt: new Date().toISOString(),
    };
  if (w.tier === 'FREE') w.summaryCredits -= 1;
  return ok({ summary });
});

// ---- voice
let transcribeSeq = 0;
route('POST', '/voice/transcribe', true, async () => {
  await sleep(900);
  const samples = ['পরের ওষুধ কখন?', 'আজ কোন ওষুধ বাকি?'];
  return ok({ transcript: samples[transcribeSeq++ % samples.length] });
});
route('POST', '/voice/query', true, async (req, _p, w) => {
  const { profileId, text } = bodyOf<{ profileId: string; text: string }>(req);
  await sleep(700);
  const now = Date.now();
  const mine = w.doses
    .filter((d) => d.profileId === profileId)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const pending = mine.filter((d) => d.status === 'SCHEDULED' || d.status === 'SNOOZED');
  const fmt = formatTimeBn;
  if (/বাকি|আজ/.test(text)) {
    if (pending.length === 0) return ok({ answerText: 'আজ আর কোনো ওষুধ বাকি নেই।' });
    return ok({
      answerText: `আজ আর ${toBn(pending.length)}টি ওষুধ বাকি আছে। ${pending.map((d) => `${fmt(d.dueAt)} ${d.medicineBn ?? d.medicine}`).join(', ')}।`,
    });
  }
  const next = pending.find((d) => new Date(d.dueAt).getTime() >= now - 45 * MIN) ?? pending[0];
  if (!next) return ok({ answerText: 'আজ আর কোনো ওষুধ বাকি নেই।' });
  return ok({
    answerText:
      `পরের ওষুধ ${fmt(next.dueAt)}। ${next.medicineBn ?? next.medicine} ${next.instructions ?? ''}।`.replace(
        /\s+/g,
        ' ',
      ),
  });
});

// ---- billing
const settleSub = (w: World) => {
  if (w.sub.status === 'PENDING' && w.sub.pendingSince && Date.now() - w.sub.pendingSince > 4000) {
    w.sub = { status: 'ACTIVE' };
    w.tier = 'PREMIUM';
  }
};
const subBody = (w: World) => ({
  status: w.sub.status,
  plan: w.role === 'PHARMACY_OWNER' ? 'PHARMACY' : 'FAMILY_CIRCLE',
  amount: '30.00',
  currency: 'BDT',
  lastConfirmedAt: w.sub.status === 'ACTIVE' ? new Date().toISOString() : null,
});

route('GET', '/billing/subscription/status', true, (_r, _p, w) => {
  settleSub(w);
  return ok(subBody(w));
});
route('POST', '/billing/subscription/subscribe', true, async (req, _p, w) => {
  const b = bodyOf<{ consentAccepted: boolean }>(req);
  if (!b.consentAccepted) return fail(400, 'CONSENT_REQUIRED');
  await sleep(500);
  // Premium only unlocks from the server's own record, after the carrier confirms (design.md 6.12).
  w.sub = { status: 'PENDING', pendingSince: Date.now() };
  return ok(subBody(w));
});
route('POST', '/billing/subscription/unsubscribe', true, async (_r, _p, w) => {
  await sleep(400);
  w.sub = { status: 'CANCELLED' };
  w.tier = 'FREE';
  return ok(subBody(w));
});
route('POST', '/billing/caas/initiate', true, async (req, _p, w) => {
  const b = bodyOf<{ purpose: string }>(req);
  await sleep(500);
  const id = nid('chg');
  w.charges.set(id, { purpose: b.purpose, status: 'OTP_SENT', attempts: 0 });
  return ok({ chargeId: id, amount: '5.00', currency: 'BDT', status: 'OTP_SENT' });
});
const grant = (w: World, purpose: string) => {
  if (purpose === 'SCAN') w.scanCredits += 1;
  if (purpose === 'DOCTOR_SUMMARY') w.summaryCredits += 1;
};
route('POST', '/billing/caas/verify', true, async (req, _p, w) => {
  const b = bodyOf<{ chargeId: string; otp: string }>(req);
  const c = w.charges.get(b.chargeId);
  if (!c) return fail(404, 'NOT_FOUND');
  await sleep(500);
  if (b.otp === '000000') {
    c.status = 'INSUFFICIENT_BALANCE';
    return ok({ chargeId: b.chargeId, status: 'INSUFFICIENT_BALANCE' });
  }
  if (b.otp !== OTP) {
    c.attempts += 1;
    return ok({ chargeId: b.chargeId, status: 'OTP_SENT', code: 'OTP_WRONG' });
  }
  c.status = 'PENDING'; // P1003: nothing is granted until the charging notification arrives
  c.verifiedAt = Date.now();
  return ok({ chargeId: b.chargeId, status: 'PENDING' });
});
route('GET', '/billing/caas/:id', true, (_r, [id], w) => {
  const c = w.charges.get(id ?? '');
  if (!c) return fail(404, 'NOT_FOUND');
  if (c.status === 'PENDING' && c.verifiedAt && Date.now() - c.verifiedAt > 2500) {
    c.status = 'SETTLED';
    grant(w, c.purpose);
  }
  return ok({ chargeId: id, status: c.status });
});
route('GET', '/billing/entitlements', true, (_r, _p, w) => {
  settleSub(w);
  return ok({
    tier: w.tier,
    scans: { used: w.scans, limit: w.tier === 'PREMIUM' ? 999 : FREE_SCAN_LIMIT },
    sms: { used: 18, limit: w.tier === 'PREMIUM' ? 500 : 30 },
    doctorSummaryCredits: w.summaryCredits,
    features:
      w.tier === 'PREMIUM'
        ? ['CAREGIVER_ALERTS', 'INSIGHTS', 'DOCTOR_SUMMARY', 'UNLIMITED_VAULT']
        : [],
  });
});

// ---- reports
route('GET', '/reports', true, () =>
  ok({ reports: REPORTS.map(({ values: _v, ...r }) => r).sort((a, b) => newest(a.date, b.date)) }),
);
route('GET', '/reports/:id', true, (_r, [id]) => {
  const r = REPORTS.find((x) => x.id === id);
  return r ? ok(r) : fail(404, 'NOT_FOUND');
});
route('POST', '/reports/upload-and-parse', true, async () => {
  await sleep(1800);
  const r = REPORTS[0];
  return r ? ok({ ...r, id: nid('rep'), date: dhakaDateKey(Date.now()) }) : fail(500, 'MOCK_EMPTY');
});

// ---- drugs
function nameMatches(d: (typeof DRUGS)[number], q: string): boolean {
  const s = q.toLowerCase().trim();
  if (!s) return false;
  const bn = [d.nameBn, ...(BN_ALIASES[d.id] ?? [])];
  return (
    d.nameEn.toLowerCase().includes(s) ||
    d.generic.toLowerCase().includes(s) ||
    bn.some((x) => x.includes(q.trim()) || q.trim().includes(x))
  );
}
route('GET', '/drugs/search', true, (req) => {
  const q = String(req.query.q ?? '');
  return ok({ results: DRUGS.filter((d) => nameMatches(d, q)).slice(0, 12) });
});
route('GET', '/drugs/generics', true, (req) => {
  const brand = String(req.query.brand ?? '');
  const original = DRUGS.find((d) => nameMatches(d, brand));
  if (!original) return fail(404, 'NOT_FOUND');
  const alternatives = DRUGS.filter(
    (d) =>
      d.id !== original.id &&
      d.generic === original.generic &&
      d.strength === original.strength &&
      d.form === original.form,
  ).map((d) => ({
    ...d,
    savingPercent:
      d.indicativePrice < original.indicativePrice
        ? Math.round(
            ((original.indicativePrice - d.indicativePrice) / original.indicativePrice) * 100,
          )
        : null,
  }));
  return ok({
    original,
    alternatives,
    note: 'ওষুধ পরিবর্তনের পূর্বে অবশ্যই আপনার ডাক্তার বা ফার্মাসিস্টের পরামর্শ গ্রহণ করুন।',
  });
});

// ---- pharmacies
const DHAKA_CENTER = { lat: 23.7461, lng: 90.3742 };
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
route('GET', '/pharmacies', true, (req) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const area = String(req.query.area ?? '').trim();
  const drugId = req.query.drugId as string | undefined;
  const radius = Number(req.query.radiusKm ?? 3);
  let origin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DHAKA_CENTER;
  // An emulator reports a US location; demo from central Dhaka instead.
  if (km(origin, DHAKA_CENTER) > 60) origin = DHAKA_CENTER;
  const now = Date.now();
  let list = PHARMACIES.map((p) => ({ p, d: km(origin, p) }));
  if (area) list = list.filter(({ p }) => p.address.includes(area) || p.name.includes(area));
  else list = list.filter(({ d }) => d <= radius);
  list.sort((a, b) => Number(b.p.isPartner) - Number(a.p.isPartner) || a.d - b.d);
  return ok({
    pharmacies: list.map(({ p, d }) => {
      const s = drugId ? p.stock[drugId] : undefined;
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        distanceKm: area ? null : Math.round(d * 10) / 10,
        phone: p.phone,
        isPartner: p.isPartner,
        stockStatus: s?.status,
        stockUpdatedAt: s ? new Date(now - s.minutesAgo * MIN).toISOString() : undefined,
      };
    }),
  });
});

route('GET', '/pharmacies/me', true, (_r, _p, w) => {
  settleSub(w);
  const profile = {
    ...w.pharmacyProfile,
    isPartner: w.sub.status === 'ACTIVE',
    priorityListing: w.sub.status === 'ACTIVE',
  };
  return ok({
    profile,
    stock: DRUGS.filter((d) => w.stock.has(d.id)).map((d) => ({
      drugId: d.id,
      nameEn: d.nameEn,
      nameBn: d.nameBn,
      strength: d.strength,
      status: w.stock.get(d.id)?.status ?? 'OUT_OF_STOCK',
      updatedAt: w.stock.get(d.id)?.updatedAt,
    })),
  });
});
route('PUT', '/pharmacies/me/stock/:id', true, (req, [id], w) => {
  const { status } = bodyOf<{ status: StockStatus }>(req);
  w.stock.set(id ?? '', { status, updatedAt: new Date().toISOString() });
  return ok({ success: true });
});
route('PUT', '/pharmacies/me/profile', true, (req, _p, w) => {
  w.pharmacyProfile = { ...w.pharmacyProfile, ...bodyOf<StoreProfile>(req) };
  return ok({ success: true });
});

// ---- appointments (docs/domain-api.md): follow-up visits, reminded the day before
const appointments = new Map<
  string,
  { id: string; title: string; dueAt: string; reminderState: string }[]
>();
route('GET', '/profiles/:id/appointments', true, (_req, [id]) =>
  ok({ appointments: appointments.get(id ?? '') ?? [] }),
);
route('POST', '/profiles/:id/appointments', true, (req, [id]) => {
  const b = bodyOf<{ title: string; dueAt: string }>(req);
  if (!b.title || !(new Date(b.dueAt).getTime() > Date.now())) return fail(400, 'INVALID_INPUT');
  const a = { id: nid('apt'), title: b.title, dueAt: b.dueAt, reminderState: 'PENDING' };
  appointments.set(
    id ?? '',
    [...(appointments.get(id ?? '') ?? []), a].sort((x, y) => x.dueAt.localeCompare(y.dueAt)),
  );
  return ok(a, 201);
});

// ---- insights
route('GET', '/insights/:id', true, (_r, _p, w) => {
  const premium = w.tier === 'PREMIUM';
  return ok({
    timeline: [...TIMELINE].sort((a, b) => newest(a.date, b.date)),
    patterns: premium ? PATTERNS : [],
    patternsLocked: !premium,
  });
});

// ---- account
route('GET', '/account/settings', true, (_r, _p, w) => ok(w.settings));
route('PUT', '/account/settings', true, (req, _p, w) => {
  w.settings = { ...w.settings, ...bodyOf<Partial<World['settings']>>(req) };
  return ok(w.settings);
});
route('POST', '/account/opt-out', true, (req, _p, w) => {
  const { scope } = bodyOf<{ scope: 'SMS' | 'SUBSCRIPTION' | 'ALL' }>(req);
  if (scope !== 'SUBSCRIPTION') w.settings.smsReminders = false;
  if (scope !== 'SMS') {
    w.sub = { status: 'CANCELLED' };
    w.tier = 'FREE';
  }
  return ok({ success: true });
});
route('DELETE', '/account', true, (_r, _p, w) => {
  if (!w.stepUp) return fail(403, 'STEP_UP_REQUIRED');
  worlds.delete(w.msisdn);
  return ok({ success: true });
});

// ---- admin
route('GET', '/admin/traces', true, (_r, _p, w) =>
  w.isAdmin ? ok({ traces: TRACES }) : fail(403, 'FORBIDDEN'),
);

// ---------------------------------------------------------------------------------------------

export async function mockRequest(req: MockReq): Promise<MockRes> {
  await sleep(120); // feel like a network
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(req.path);
    if (!m) continue;
    let w: World | null = null;
    if (r.auth) {
      w = worldFor(req.token, req.hybrid);
      if (!w) return fail(401, 'UNAUTHORIZED');
    }
    return r.handler(req, m.slice(1), w as World);
  }
  return fail(404, 'NOT_FOUND');
}
