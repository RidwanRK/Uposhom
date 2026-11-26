/**
 * Live API smoke test for the mobile app's integration. It makes the same calls, with the same request
 * bodies, that apps/mobile/src/api/endpoints.ts makes, against a running backend, and checks every
 * response against the shared zod contracts.
 *
 *   pnpm dev:local                                   # in one terminal
 *   pnpm --filter @uposhom/mobile smoke:live         # in another (API_URL defaults to localhost:3000)
 *
 * Uses only synthetic data and the local fake Applink. It signs up a throwaway number each run.
 */
import {
  accountSettings,
  drugSearchResponse,
  genericsResponse,
  insightsResponse,
  journalResponse,
  pharmaciesResponse,
  reportDetail,
  reportListResponse,
  transcribeResponse,
  uploadAndParseResponse,
  voiceQueryResponse,
  alertsResponse,
  appointment,
  appointmentsResponse,
  caasInitiateResponse,
  caasVerifyResponse,
  circleResponse,
  confirmResponse,
  doseActionResponse,
  entitlementsResponse,
  okResponse,
  otpRequestResponse,
  otpVerifyResponse,
  profile,
  refreshResponse,
  stepUpVerifyResponse,
  subscriptionStatusResponse,
  todayDosesResponse,
} from '@uposhom/shared';
import type { z } from 'zod';

const BASE = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
let token = '';
let failures = 0;

async function call<T>(
  label: string,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    schema?: z.ZodType<T>;
    expect?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: T | undefined; raw: unknown }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const raw: unknown = text ? JSON.parse(text) : null;
  const want = opts.expect ?? 200;
  let ok = res.status === want;
  let data: T | undefined;
  let why = ok ? '' : `status ${res.status}, wanted ${want}: ${text.slice(0, 160)}`;
  if (ok && opts.schema) {
    const parsed = opts.schema.safeParse(raw);
    if (parsed.success) data = parsed.data;
    else {
      ok = false;
      why = `contract mismatch: ${parsed.error.message.slice(0, 200)}`;
    }
  }
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${why ? `\n      ${why}` : ''}`);
  return { status: res.status, data, raw };
}

const phone = `0171${String(Date.now()).slice(-7)}`;

// ---- sign-up (the same body the app sends, including accountType)
await call('otp/request', 'POST', '/auth/otp/request', {
  body: { msisdn: phone },
  schema: otpRequestResponse,
});
const verify = await call('otp/verify', 'POST', '/auth/otp/verify', {
  body: { msisdn: phone, otp: '123456', accountType: 'INDIVIDUAL' },
  schema: otpVerifyResponse,
});
token = verify.data?.token ?? '';
const refreshToken = verify.data?.refreshToken ?? '';
console.log(`      role=${verify.data?.user.role} refreshToken=${refreshToken ? 'yes' : 'NO'}`);

// ---- circle and profiles
const circle = await call('circles', 'GET', '/circles', { schema: circleResponse });
const me = circle.data?.profiles[0];
if (!me) throw new Error('no own profile');
console.log(
  `      tier=${circle.data?.circle.tier} profiles=${circle.data?.profiles.length} maxProfiles=${circle.data?.circle.maxProfiles ?? 'n/a'}`,
);
await call('profile update (meal times, allergies)', 'PUT', `/profiles/${me.id}`, {
  body: {
    allergies: 'পেনিসিলিন',
    mealTimes: { morning: '08:00', noon: '13:30', evening: '17:00', night: '20:30' },
  },
  schema: profile,
});
await call('profile update with bad meal order -> 400', 'PUT', `/profiles/${me.id}`, {
  body: { mealTimes: { morning: '13:00', noon: '08:00', evening: '17:00', night: '20:30' } },
  expect: 400,
});
await call('add dependent on Free -> 402 PAYMENT_REQUIRED', 'POST', '/profiles', {
  body: { name: 'বাবা', relationship: 'FATHER', age: 68 },
  expect: 402,
});

// ---- prescription confirm (typed entry: id "new") and the dose timeline
await call(
  'confirm with unschedulable pattern -> 422 NEEDS_MANUAL_INPUT',
  'POST',
  '/prescriptions/new/confirm',
  {
    body: {
      profileId: me.id,
      items: [
        {
          brandName: 'Napa',
          dosageStrength: '500mg',
          form: 'Tablet',
          parsedPattern: '1+1',
          mealRelation: 'PC',
          durationDays: 5,
          isCritical: false,
        },
      ],
    },
    expect: 422,
  },
);
const conf = await call('confirm prescription', 'POST', '/prescriptions/new/confirm', {
  body: {
    profileId: me.id,
    items: [
      {
        brandName: 'Napa Extra',
        dosageStrength: '500mg+65mg',
        form: 'Tablet',
        parsedPattern: '1+0+1',
        mealRelation: 'PC',
        durationDays: 5,
        isCritical: true,
      },
      {
        brandName: 'Seclo',
        dosageStrength: '20mg',
        form: 'Capsule',
        parsedPattern: '1+0+0',
        mealRelation: 'AC',
        durationDays: 14,
        isCritical: false,
        pillCount: 28,
      },
    ],
  },
  schema: confirmResponse,
  expect: 201,
});
console.log(`      events=${conf.data?.scheduledEventsCount} first=${conf.data?.firstDoseAt}`);
const today = await call('doses/today?days=2', 'GET', `/doses/today?profileId=${me.id}&days=2`, {
  schema: todayDosesResponse,
});
const doses = today.data?.doses ?? [];
console.log(`      doses=${doses.length} adherence=${today.data?.adherenceRate ?? 'n/a'}`);
const far = [...doses].sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
if (far)
  await call('act on a far-future dose -> 409 DOSE_NOT_DUE', 'POST', `/doses/${far.id}/action`, {
    body: { action: 'TAKEN' },
    expect: 409,
  });
const soonest = [...doses]
  .filter((d) => d.status === 'SCHEDULED')
  .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
if (soonest && new Date(soonest.dueAt).getTime() - Date.now() < 2 * 3600 * 1000) {
  await call('dose action TAKEN (notification header)', 'POST', `/doses/${soonest.id}/action`, {
    body: { action: 'TAKEN' },
    headers: { 'X-Action-Source': 'notification' },
    schema: doseActionResponse,
  });
} else console.log('SKIP  dose action (nothing due within 2 hours right now)');

// ---- alerts, devices, appointments
await call('alerts', 'GET', '/alerts', { schema: alertsResponse });
await call('devices (push token)', 'POST', '/devices', {
  body: { expoPushToken: 'ExponentPushToken[smoke-test]', platform: 'android' },
  schema: okResponse,
});
const due = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const dueIso = `${new Date(due.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10)}T10:00:00+06:00`;
await call('appointment add', 'POST', `/profiles/${me.id}/appointments`, {
  body: { title: 'ডাক্তার দেখানো', dueAt: dueIso },
  schema: appointment,
  expect: 201,
});
await call('appointment list', 'GET', `/profiles/${me.id}/appointments`, {
  schema: appointmentsResponse,
});

// ---- scans, reports, journal, voice, insights, drugs, pharmacies, settings (apps/api features.ts).
// Without OPENROUTER_API_KEY on the server the AI answers with workstream C's built-in samples.
async function upload<T>(
  label: string,
  path: string,
  field: string,
  type: string,
  schema: z.ZodType<T>,
  fields: Record<string, string> = {},
): Promise<T | undefined> {
  // Same order as the app's FormData: the file first, then the fields.
  const form = new FormData();
  form.append(field, new Blob([new Uint8Array([1, 2, 3, 4])], { type }), 'upload');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  const parsed = res.status === 200 ? schema.safeParse(text ? JSON.parse(text) : null) : null;
  const ok = parsed?.success === true;
  if (!ok) failures++;
  const why = ok
    ? ''
    : res.status !== 200
      ? `status ${res.status}: ${text.slice(0, 160)}`
      : `contract mismatch: ${parsed?.error?.message.slice(0, 200)}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${why ? `\n      ${why}` : ''}`);
  return parsed?.success ? parsed.data : undefined;
}

const scan = await upload(
  'prescription scan (multipart)',
  '/prescriptions/upload-and-parse',
  'file',
  'image/webp',
  uploadAndParseResponse,
  { profileId: me.id },
);
console.log(`      draft=${scan?.draftPrescriptionId} items=${scan?.extractedItems.length}`);
if (scan) {
  await call(
    'confirm the scanned draft',
    'POST',
    `/prescriptions/${scan.draftPrescriptionId}/confirm`,
    {
      body: {
        profileId: me.id,
        items: scan.extractedItems.map((i) => ({
          brandName: i.brandName,
          dosageStrength: i.strength,
          form: i.form,
          parsedPattern: i.pattern,
          mealRelation: i.mealRelation,
          durationDays: i.durationDays,
          isCritical: false,
        })),
      },
      schema: confirmResponse,
      expect: 201,
    },
  );
}
const rep = await upload(
  'report scan (multipart)',
  '/reports/upload-and-parse',
  'file',
  'image/webp',
  reportDetail,
  {
    profileId: me.id,
  },
);
await call('report list', 'GET', `/reports?profileId=${me.id}`, { schema: reportListResponse });
if (rep) await call('report detail', 'GET', `/reports/${rep.id}`, { schema: reportDetail });
const j = await call('symptom journal (first turn)', 'POST', '/symptoms/journal', {
  body: { profileId: me.id, inputText: 'তিন দিন ধরে জ্বর', channel: 'TEXT' },
  schema: journalResponse,
});
console.log(
  `      next=${j.data?.nextQuestion ? 'question' : 'none'} ${j.data?.questionIndex}/${j.data?.questionTotal}`,
);
await call('symptom journal red flag', 'POST', '/symptoms/journal', {
  body: { profileId: me.id, inputText: 'হঠাৎ তীব্র শ্বাসকষ্ট', channel: 'TEXT' },
  schema: journalResponse,
});
await call('doctor summary on Free -> 402 PAYMENT_REQUIRED', 'POST', '/summaries/doctor', {
  body: { profileId: me.id },
  expect: 402,
});
await upload(
  'voice transcribe (multipart)',
  '/voice/transcribe',
  'audio',
  'audio/mp4',
  transcribeResponse,
);
await call('voice query', 'POST', '/voice/query', {
  body: { profileId: me.id, text: 'আমার পরের ওষুধ কখন?' },
  schema: voiceQueryResponse,
});
await call('insights', 'GET', `/insights/${me.id}`, { schema: insightsResponse });
await call('drug search', 'GET', `/drugs/search?q=${encodeURIComponent('napa')}`, {
  schema: drugSearchResponse,
});
await call('drug generics', 'GET', '/drugs/generics?brand=Napa', { schema: genericsResponse });
await call('pharmacies near', 'GET', '/pharmacies?area=Dhanmondi', { schema: pharmaciesResponse });
await call('my pharmacy as an individual -> 403', 'GET', '/pharmacies/me', { expect: 403 });
await call('settings', 'GET', '/account/settings', { schema: accountSettings });
await call('settings update', 'PUT', '/account/settings', {
  body: { discreetSms: true },
  schema: accountSettings,
});

// ---- billing: entitlements, subscription, pay per use
await call('entitlements', 'GET', '/billing/entitlements', { schema: entitlementsResponse });
await call('subscription status (before)', 'GET', '/billing/subscription/status', {
  schema: subscriptionStatusResponse,
});
const charge = await call('caas initiate (DOCTOR_SUMMARY)', 'POST', '/billing/caas/initiate', {
  body: {
    purpose: 'DOCTOR_SUMMARY',
    consentWording: 'এই কাজের জন্য ৫ টাকা (৳৫.০০) আপনার মোবাইল ব্যালেন্স থেকে কাটা হবে।',
  },
  schema: caasInitiateResponse,
});
if (charge.data) {
  await call('caas wrong code is retryable (OTP_WRONG)', 'POST', '/billing/caas/verify', {
    body: { chargeId: charge.data.chargeId, otp: '123456' },
    schema: caasVerifyResponse,
  });
  await new Promise((r) => setTimeout(r, 2500));
  await call(
    'caas status (settled by the dev proxy)',
    'GET',
    `/billing/caas/${charge.data.chargeId}`,
    { schema: caasVerifyResponse },
  );
}
await call('subscribe without consent -> 400', 'POST', '/billing/subscription/subscribe', {
  body: {},
  expect: 400,
});
await call('subscribe with consent', 'POST', '/billing/subscription/subscribe', {
  body: {
    consentAccepted: true,
    consentWording: 'মাসিক চার্জ: ৩০ টাকা (৳৩০) আপনার মোবাইল অ্যাকাউন্ট থেকে কাটা হবে।',
  },
  schema: subscriptionStatusResponse,
});
await call('subscription status (after)', 'GET', '/billing/subscription/status', {
  schema: subscriptionStatusResponse,
});

// ---- admin is forbidden for a normal account
await call('admin traces as non-admin -> 403', 'GET', '/admin/traces', { expect: 403 });

// ---- session: refresh, step-up, delete, logout
const refreshed = await call('refresh', 'POST', '/auth/refresh', {
  body: { refreshToken },
  schema: refreshResponse,
});
if (refreshed.data) token = refreshed.data.token;
await call('step-up request', 'POST', '/auth/step-up/request', { schema: okResponse });
const step = await call('step-up verify', 'POST', '/auth/step-up/verify', {
  body: { otp: '123456' },
  schema: stepUpVerifyResponse,
});
await call('delete account needs step-up (without token -> 403)', 'DELETE', '/account', {
  expect: 403,
});
if (step.data)
  await call('delete my data', 'DELETE', '/account', {
    headers: { 'X-Step-Up-Token': step.data.stepUpToken },
    schema: okResponse,
  });
await call('logout with refresh token', 'POST', '/auth/logout', {
  body: { refreshToken },
  schema: okResponse,
});

console.log(failures === 0 ? '\nAll live API checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
