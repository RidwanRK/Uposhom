import { describe, expect, it, vi } from 'vitest';
import {
  accountSettings,
  doctorSummaryResponse,
  drugSearchResponse,
  genericsResponse,
  insightsResponse,
  journalResponse,
  myPharmacyResponse,
  pharmaciesResponse,
  reportDetail,
  reportListResponse,
  transcribeResponse,
  uploadAndParseResponse,
  voiceQueryResponse,
} from '@uposhom/shared';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import { nextId, settle, OTHER, SUB } from './platform.js';
import { domainHarness } from './domain-harness.js';

// No OPENROUTER_API_KEY in tests: C's functions answer with their built-in samples, so these tests
// check the server's side (access, storage, gating, shapes), not the model.
delete process.env['OPENROUTER_API_KEY'];

/** A multipart/form-data body, as the app's FormData sends it (the file first, then fields). */
function multipart(
  parts: Array<{ name: string; value?: string; file?: { type: string; data: Buffer } }>,
) {
  const boundary = `----uposhom${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.file) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${p.name}"; filename="upload"\r\nContent-Type: ${p.file.type}\r\n\r\n`,
        ),
        p.file.data,
        Buffer.from('\r\n'),
      );
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const IMAGE = { type: 'image/webp', data: Buffer.from('RIFF....WEBPVP8 fake image bytes') };
const AUDIO = { type: 'audio/m4a', data: Buffer.from('fake audio bytes') };

async function setup() {
  const store = createMemoryDomainStore();
  const h = await domainHarness({ store });
  const user = await h.addUser(SUB);
  const self = (await h.api(user, 'GET', '/circles')).json().profiles[0];
  const upload = async (
    url: string,
    field: string,
    file: typeof IMAGE,
    fields: Record<string, string> = {},
  ) => {
    const body = multipart([
      { name: field, file },
      ...Object.entries(fields).map(([name, value]) => ({ name, value })),
    ]);
    return h.api(user, 'POST', url, body.payload, body.headers);
  };
  return { h, store, user, self, upload };
}

describe('prescription scan', () => {
  it('reads the photo, saves a draft the confirm screen can confirm', async () => {
    const t = await setup();
    const res = await t.upload('/prescriptions/upload-and-parse', 'file', IMAGE, {
      profileId: t.self.id,
    });
    expect(res.statusCode).toBe(200);
    const body = uploadAndParseResponse.parse(res.json());
    expect(body.draftPrescriptionId).toMatch(/^pre_/);
    expect(body.extractedItems.length).toBeGreaterThan(0);

    const items = body.extractedItems.map((i) => ({
      brandName: i.brandName,
      dosageStrength: i.strength,
      form: i.form,
      parsedPattern: i.pattern,
      mealRelation: i.mealRelation,
      durationDays: i.durationDays,
      isCritical: false,
    }));
    const confirmed = await t.h.api(
      t.user,
      'POST',
      `/prescriptions/${body.draftPrescriptionId}/confirm`,
      {
        profileId: t.self.id,
        items,
      },
    );
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().prescriptionId).toBe(body.draftPrescriptionId);
    await t.h.app.close();
  });

  it('uses the own profile when none is sent, and refuses non-images, missing files and strangers', async () => {
    const t = await setup();
    expect((await t.upload('/prescriptions/upload-and-parse', 'file', IMAGE)).statusCode).toBe(200);
    const pdf = await t.upload('/prescriptions/upload-and-parse', 'file', {
      type: 'application/pdf',
      data: Buffer.from('x'),
    });
    expect(pdf.json().error).toEqual({ code: 'INVALID_INPUT', message: 'FILE_TYPE' });
    const noFile = await t.upload('/prescriptions/upload-and-parse', 'other', IMAGE);
    expect(noFile.json().error).toEqual({ code: 'INVALID_INPUT', message: 'FILE' });
    const json = await t.h.api(t.user, 'POST', '/prescriptions/upload-and-parse', { file: 'x' });
    expect(json.json().error.message).toBe('MULTIPART');

    const stranger = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    const body = multipart([
      { name: 'file', file: IMAGE },
      { name: 'profileId', value: t.self.id },
    ]);
    const res = await t.h.api(
      stranger,
      'POST',
      '/prescriptions/upload-and-parse',
      body.payload,
      body.headers,
    );
    expect(res.statusCode).toBe(404);
    await t.h.app.close();
  });

  it('a used-up scan quota answers 402 SCAN, as the app’s payment sheet expects', async () => {
    const t = await setup();
    vi.spyOn(t.h.app.services.entitlements, 'useScan').mockResolvedValue({
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      payWith: { purpose: 'SCAN', amount: '5.00', currency: 'BDT' },
    });
    const res = await t.upload('/prescriptions/upload-and-parse', 'file', IMAGE);
    expect(res.statusCode).toBe(402);
    expect(res.json().error).toEqual({ code: 'PAYMENT_REQUIRED', message: 'SCAN' });
    await t.h.app.close();
  });
});

describe('report vault', () => {
  it('scans a report, lists it, opens it, and audits a caregiver reading it', async () => {
    const t = await setup();
    const res = await t.upload('/reports/upload-and-parse', 'file', IMAGE, {
      profileId: t.self.id,
    });
    expect(res.statusCode).toBe(200);
    const detail = reportDetail.parse(res.json());
    expect(detail.id).toMatch(/^rep_/);
    expect(detail.values.length).toBeGreaterThan(0);

    const list = reportListResponse.parse((await t.h.api(t.user, 'GET', '/reports')).json());
    expect(list.reports.map((r) => r.id)).toEqual([detail.id]);
    const opened = reportDetail.parse(
      (await t.h.api(t.user, 'GET', `/reports/${detail.id}`)).json(),
    );
    expect(opened.values).toEqual(detail.values);
    expect(await t.store.audit.listForActor(t.user.id)).toEqual([]); // the patient reading their own

    const carer = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    await t.store.profiles.addLink({
      id: nextId(),
      userId: carer.id,
      profileId: t.self.id,
      role: 'CAREGIVER',
      isSecondaryCaregiver: false,
      createdAt: t.h.clock.now,
    });
    expect((await t.h.api(carer, 'GET', `/reports/${detail.id}`)).statusCode).toBe(200);
    expect((await t.store.audit.listForActor(carer.id)).map((a) => a.action)).toEqual([
      'READ_REPORT',
    ]);

    const stranger = await t.h.addUser('tel:8801733333333', { msisdn: '8801733333333' });
    expect((await t.h.api(stranger, 'GET', `/reports/${detail.id}`)).statusCode).toBe(404);
    expect((await t.h.api(stranger, 'GET', `/reports?profileId=${t.self.id}`)).statusCode).toBe(
      404,
    );
    expect((await t.h.api(t.user, 'GET', '/reports/rep_none')).statusCode).toBe(404);
    await t.h.app.close();
  });
});

describe('symptom journal and doctor summary', () => {
  async function finishJournal(t: Awaited<ReturnType<typeof setup>>) {
    let res = journalResponse.parse(
      (
        await t.h.api(t.user, 'POST', '/symptoms/journal', {
          profileId: t.self.id,
          inputText: 'তিন দিন ধরে জ্বর আর মাথাব্যথা',
          channel: 'TEXT',
        })
      ).json(),
    );
    for (let i = 0; i < 10 && !res.doctorSummaryReady; i++) {
      res = journalResponse.parse(
        (
          await t.h.api(t.user, 'POST', '/symptoms/journal', {
            profileId: t.self.id,
            inputText: 'হ্যাঁ',
            channel: 'TEXT',
            sessionId: res.sessionId,
          })
        ).json(),
      );
    }
    return res;
  }

  it('a finished journal is kept, and its summary id is the stored log', async () => {
    const t = await setup();
    const res = await finishJournal(t);
    expect(res.doctorSummaryReady).toBe(true);
    expect(res.summary?.id).toMatch(/^sym_/);
    const logs = await t.store.symptoms.listForProfile(t.self.id, 10);
    expect(logs.map((l) => l.id)).toEqual([res.summary!.id]);
    await t.h.app.close();
  });

  it('a red flag answers at once with 999 and is kept as a red-flag log', async () => {
    const t = await setup();
    const res = journalResponse.parse(
      (
        await t.h.api(t.user, 'POST', '/symptoms/journal', {
          profileId: t.self.id,
          inputText: 'হঠাৎ তীব্র শ্বাসকষ্ট হচ্ছে',
          channel: 'TEXT',
        })
      ).json(),
    );
    expect(res.isRedFlag).toBe(true);
    expect(res.alertMessage).toContain('৯৯৯');
    expect((await t.store.symptoms.listForProfile(t.self.id, 10))[0]?.redFlag).toBe(true);
    await t.h.app.close();
  });

  it('the doctor summary uses the journal and the confirmed medicines, and is paid for on Free', async () => {
    const t = await setup();
    const journal = await finishJournal(t);
    await t.h.api(t.user, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        {
          brandName: 'Napa',
          dosageStrength: '500mg',
          form: 'Tablet',
          parsedPattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 5,
          isCritical: false,
        },
      ],
    });

    const gate = vi.spyOn(t.h.app.services.entitlements, 'useFeature');
    gate.mockResolvedValueOnce({
      allowed: false,
      reason: 'QUOTA_EXCEEDED',
      payWith: { purpose: 'DOCTOR_SUMMARY', amount: '10.00', currency: 'BDT' },
    });
    const refused = await t.h.api(t.user, 'POST', '/summaries/doctor', { profileId: t.self.id });
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error).toEqual({ code: 'PAYMENT_REQUIRED', message: 'DOCTOR_SUMMARY' });

    gate.mockResolvedValue({ allowed: true, via: 'CREDIT' });
    const res = doctorSummaryResponse.parse(
      (await t.h.api(t.user, 'POST', '/summaries/doctor', { profileId: t.self.id })).json(),
    );
    expect(res.summary.id).toBe(journal.summary!.id);
    expect(res.summary.currentMedicines).toEqual(['Napa 500mg']);
    expect(res.summary.recentPrescriptions).toEqual(['Napa 500mg (২২ নভেম্বর)']);

    const other = await t.h.api(t.user, 'POST', '/summaries/doctor', {
      profileId: t.self.id,
      summaryId: 'sym_none',
    });
    expect(other.statusCode).toBe(404);
    await t.h.app.close();
  });

  it('with no journal yet the summary says so instead of failing', async () => {
    const t = await setup();
    vi.spyOn(t.h.app.services.entitlements, 'useFeature').mockResolvedValue({
      allowed: true,
      via: 'PREMIUM',
    });
    const res = doctorSummaryResponse.parse(
      (await t.h.api(t.user, 'POST', '/summaries/doctor', { profileId: t.self.id })).json(),
    );
    expect(res.summary.symptoms).toBe('কোনো সাম্প্রতিক লক্ষণ নেই');
    await t.h.app.close();
  });
});

describe('voice', () => {
  it('transcribes a recording and answers from this profile’s own doses, traced', async () => {
    const t = await setup();
    const tr = await t.upload('/voice/transcribe', 'audio', AUDIO);
    expect(transcribeResponse.parse(tr.json()).transcript.length).toBeGreaterThan(0);
    const notAudio = await t.upload('/voice/transcribe', 'audio', IMAGE);
    expect(notAudio.json().error.message).toBe('FILE_TYPE');

    await t.h.api(t.user, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        {
          brandName: 'Seclo',
          dosageStrength: '20mg',
          form: 'Capsule',
          parsedPattern: '0+0+1',
          mealRelation: 'NONE',
          durationDays: 3,
          isCritical: false,
        },
      ],
    });
    const res = await t.h.api(t.user, 'POST', '/voice/query', {
      profileId: t.self.id,
      text: 'আমার পরের ওষুধ কখন?',
    });
    expect(res.statusCode).toBe(200);
    expect(voiceQueryResponse.parse(res.json()).answerText.length).toBeGreaterThan(0);
    expect((await t.store.traces.list(5)).length).toBeGreaterThan(0);

    const stranger = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    expect(
      (await t.h.api(stranger, 'POST', '/voice/query', { profileId: t.self.id, text: 'x' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.h.api(t.user, 'POST', '/voice/query', { profileId: t.self.id, text: '  ' }))
        .statusCode,
    ).toBe(400);
    await t.h.app.close();
  });
});

describe('insights', () => {
  it('answers in the app’s shape; patterns are locked on Free and open on Premium', async () => {
    const t = await setup();
    const free = insightsResponse.parse(
      (await t.h.api(t.user, 'GET', `/insights/${t.self.id}`)).json(),
    );
    expect(free.patterns).toEqual([]);
    vi.spyOn(t.h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    const premium = insightsResponse.parse(
      (await t.h.api(t.user, 'GET', `/insights/${t.self.id}`)).json(),
    );
    expect(premium.patternsLocked).not.toBe(true);
    expect((await t.h.api(t.user, 'GET', '/insights/prf_none')).statusCode).toBe(404);
    await t.h.app.close();
  });

  it('a real profile sees only its own history, never the demo data', async () => {
    const t = await setup();
    vi.spyOn(t.h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    const before = insightsResponse.parse(
      (await t.h.api(t.user, 'GET', `/insights/${t.self.id}`)).json(),
    );
    expect(before.timeline).toEqual([]);
    expect(before.patterns).toEqual([]);

    await t.h.api(t.user, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        {
          brandName: 'Seclo',
          dosageStrength: '20mg',
          form: 'Capsule',
          parsedPattern: '0+0+1',
          mealRelation: 'NONE',
          durationDays: 3,
          isCritical: false,
        },
      ],
    });
    const after = insightsResponse.parse(
      (await t.h.api(t.user, 'GET', `/insights/${t.self.id}`)).json(),
    );
    expect(after.timeline).toHaveLength(1);
    expect(after.timeline[0]).toMatchObject({ kind: 'PRESCRIPTION' });
    expect(after.timeline[0]!.title).toContain('Seclo');
    await t.h.app.close();
  });
});

describe('generic medicine finder', () => {
  it('searches the DGDA catalogue in Latin and Bangla, and finds alternatives', async () => {
    const t = await setup();
    const latin = drugSearchResponse.parse(
      (await t.h.api(t.user, 'GET', '/drugs/search?q=napa')).json(),
    );
    expect(latin.results.some((d) => d.nameEn === 'Napa')).toBe(true);
    const bangla = drugSearchResponse.parse(
      (await t.h.api(t.user, 'GET', `/drugs/search?q=${encodeURIComponent('নাপা')}`)).json(),
    );
    expect(bangla.results.length).toBeGreaterThan(0);
    expect((await t.h.api(t.user, 'GET', '/drugs/search?q=')).json()).toEqual({ results: [] });

    const alt = genericsResponse.parse(
      (await t.h.api(t.user, 'GET', '/drugs/generics?brand=Napa')).json(),
    );
    expect(alt.original.generic).toBe('Paracetamol');
    expect((await t.h.api(t.user, 'GET', '/drugs/generics?brand=zzzz-nothing')).statusCode).toBe(
      404,
    );
    await t.h.app.close();
  });
});

describe('pharmacies', () => {
  it('a Pharmacy account fills in its store and stock; customers find it with that stock', async () => {
    const t = await setup();
    const owner = await t.h.addUser('tel:8801744444444', {
      msisdn: '8801744444444',
      accountType: 'PHARMACY',
    });

    const empty = myPharmacyResponse.parse((await t.h.api(owner, 'GET', '/pharmacies/me')).json());
    expect(empty).toMatchObject({ profile: { name: '', isPartner: false }, stock: [] });

    const put = await t.h.api(owner, 'PUT', '/pharmacies/me/profile', {
      name: 'Shanti Pharmacy',
      address: 'Road 2, Mirpur 10, Dhaka',
      phone: '01744444444',
      openingHours: '9am - 11pm',
      lat: 23.8069,
      lng: 90.3687,
    });
    expect(put.json()).toEqual({ success: true });
    expect(
      (
        await t.h.api(owner, 'PUT', '/pharmacies/me/stock/dgda-napa-500', { status: 'IN_STOCK' })
      ).json(),
    ).toEqual({ success: true });
    expect(
      (await t.h.api(owner, 'PUT', '/pharmacies/me/stock/not-a-drug', { status: 'IN_STOCK' }))
        .statusCode,
    ).toBe(404);

    const mine = myPharmacyResponse.parse((await t.h.api(owner, 'GET', '/pharmacies/me')).json());
    expect(mine.profile.name).toBe('Shanti Pharmacy');
    expect(mine.stock).toEqual([
      expect.objectContaining({ drugId: 'dgda-napa-500', nameEn: 'Napa', status: 'IN_STOCK' }),
    ]);

    const found = pharmaciesResponse.parse(
      (
        await t.h.api(t.user, 'GET', '/pharmacies?lat=23.807&lng=90.369&drugId=dgda-napa-500')
      ).json(),
    );
    // Partners and priority listings come first; the new shop is in the list with its stock.
    expect(found.pharmacies.find((p) => p.name === 'Shanti Pharmacy')).toMatchObject({
      stockStatus: 'IN_STOCK',
      phone: '01744444444',
      isPartner: false,
    });
    expect(found.pharmacies[0]?.isPartner).toBe(true);

    // Only Pharmacy accounts have a store.
    expect((await t.h.api(t.user, 'GET', '/pharmacies/me')).statusCode).toBe(403);
    await t.h.app.close();
  });

  it('lists the partner pharmacies by area, partners first', async () => {
    const t = await setup();
    const res = pharmaciesResponse.parse(
      (await t.h.api(t.user, 'GET', '/pharmacies?area=Dhanmondi')).json(),
    );
    expect(res.pharmacies.length).toBeGreaterThan(0);
    expect(
      res.pharmacies.every((p) => p.address.includes('Dhanmondi') || p.name.includes('Dhanmondi')),
    ).toBe(true);
    expect(res.pharmacies.every((p) => p.distanceKm === null)).toBe(true);
    await t.h.app.close();
  });
});

describe('account settings', () => {
  it('defaults, partial updates, and the reminder SMS follows them', async () => {
    const t = await setup();
    expect(
      accountSettings.parse((await t.h.api(t.user, 'GET', '/account/settings')).json()),
    ).toEqual({
      discreetSms: false,
      smsReminders: true,
    });
    expect(
      (await t.h.api(t.user, 'PUT', '/account/settings', { discreetSms: true })).json(),
    ).toEqual({
      discreetSms: true,
      smsReminders: true,
    });
    expect(
      (await t.h.api(t.user, 'PUT', '/account/settings', { discreetSms: 'yes' })).statusCode,
    ).toBe(400);

    await t.h.api(t.user, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        {
          brandName: 'Napa',
          dosageStrength: '500mg',
          form: 'Tablet',
          parsedPattern: '1+0+1',
          mealRelation: 'PC',
          durationDays: 3,
          isCritical: false,
        },
      ],
    });
    t.h.clock.now = new Date('2026-11-22T21:30:00+06:00');
    await t.h.app.ladder.tick();
    await settle(t.h);
    const [, text] = t.h.applink.sendSms.mock.calls[0] as unknown as [string, string];
    expect(text).toBe('উপশম: ওষুধ খাওয়ার সময় (২১:৩০)। খেলে UPOSHOM 1, পরে UPOSHOM 2, বাদ UPOSHOM 3');

    await t.h.api(t.user, 'PUT', '/account/settings', { smsReminders: false });
    t.h.clock.now = new Date('2026-11-23T08:30:00+06:00');
    await t.h.app.ladder.tick();
    await settle(t.h);
    expect(t.h.applink.sendSms).toHaveBeenCalledTimes(1);
    await t.h.app.close();
  });
});
