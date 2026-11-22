import { describe, expect, it, vi } from 'vitest';
import {
  circleResponse,
  confirmResponse,
  doseActionResponse,
  todayDosesResponse,
  type ConfirmItem,
} from '@uposhom/shared';
import { nextId, settle, OTHER, SUB } from './platform.js';
import { domainHarness } from './domain-harness.js';

// The harness clock starts at 2026-11-22T10:00:00Z, which is 16:00 in Dhaka.
const dhaka = (local: string) => new Date(`${local}+06:00`);

const NAPA: ConfirmItem = {
  brandName: 'Napa Extra',
  dosageStrength: '500mg+65mg',
  form: 'Tablet',
  parsedPattern: '1+0+1',
  mealRelation: 'PC',
  durationDays: 5,
  isCritical: true,
};
const SECLO: ConfirmItem = {
  brandName: 'Seclo',
  dosageStrength: '20mg',
  form: 'Capsule',
  parsedPattern: '1+0+0',
  mealRelation: 'AC',
  durationDays: 14,
  isCritical: false,
};

async function setup() {
  const h = await domainHarness();
  const user = await h.addUser(SUB);
  const circle = (await h.api(user, 'GET', '/circles')).json();
  const self = circle.profiles[0];
  const confirm = (items: ConfirmItem[], id = 'new', profileId = self.id) =>
    h.api(user, 'POST', `/prescriptions/${id}/confirm`, { profileId, items });
  const today = async (query = '') => (await h.api(user, 'GET', `/doses/today${query}`)).json();
  const act = (doseId: string, body: object) =>
    h.api(user, 'POST', `/doses/${doseId}/action`, body);
  return { h, user, self, confirm, today, act };
}

describe('circle and profiles', () => {
  it('the first visit creates the circle with the user’s own profile, once', async () => {
    const { h, user } = await setup();
    const first = (await h.api(user, 'GET', '/circles')).json();
    const again = (await h.api(user, 'GET', '/circles')).json();
    expect(circleResponse.parse(first)).toMatchObject({
      circle: { tier: 'FREE', memberCount: 1, maxProfiles: 1 },
      profiles: [
        {
          relationship: 'SELF',
          myRole: 'ADMIN',
          status: 'OK',
          adherenceRate: null,
          mealTimes: { morning: '08:00', noon: '13:30', evening: '18:00', night: '21:00' },
        },
      ],
    });
    expect(again.circle.id).toBe(first.circle.id);
    expect(again.profiles).toHaveLength(1);
    await h.app.close();
  });

  it('Free allows only the own profile; Premium allows dependents', async () => {
    const { h, user } = await setup();
    const add = () =>
      h.api(user, 'POST', '/profiles', { name: 'Abba', relationship: 'father', age: 72 });
    const refused = await add();
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error).toEqual({ code: 'PAYMENT_REQUIRED', message: 'PREMIUM' });

    vi.spyOn(h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    const created = await add();
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Abba',
      relationship: 'FATHER',
      age: 72,
      myRole: 'ADMIN',
    });
    const circle = (await h.api(user, 'GET', '/circles')).json();
    expect(circle.circle).toMatchObject({ tier: 'PREMIUM', memberCount: 2, maxProfiles: 7 });
    await h.app.close();
  });

  it('updates meal times and refuses ones out of order', async () => {
    const { h, user, self } = await setup();
    const meals = { morning: '07:00', noon: '13:00', evening: '17:30', night: '22:00' };
    const ok = await h.api(user, 'PUT', `/profiles/${self.id}`, {
      mealTimes: meals,
      name: 'Rahim',
    });
    expect(ok.json()).toMatchObject({ name: 'Rahim', mealTimes: meals });
    const bad = await h.api(user, 'PUT', `/profiles/${self.id}`, {
      mealTimes: { ...meals, noon: '06:00' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toEqual({ code: 'INVALID_INPUT', message: 'MEAL_TIME_ORDER' });
    await h.app.close();
  });

  it('another user cannot see or change the profile', async () => {
    const { h, self } = await setup();
    const stranger = await h.addUser(OTHER, { msisdn: '8801711111111' });
    expect((await h.api(stranger, 'PUT', `/profiles/${self.id}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect((await h.api(stranger, 'GET', `/doses/today?profileId=${self.id}`)).statusCode).toBe(
      404,
    );
    await h.app.close();
  });

  it('needs a signed-in user', async () => {
    const { h } = await setup();
    expect((await h.app.inject({ method: 'GET', url: '/api/v1/circles' })).statusCode).toBe(401);
    await h.app.close();
  });
});

describe('POST /prescriptions/:id/confirm', () => {
  it('schedules a typed-in prescription with the engine, from the profile’s meal times', async () => {
    const { h, confirm } = await setup();
    const res = await confirm([NAPA, SECLO]);
    expect(res.statusCode).toBe(201);
    const body = confirmResponse.parse(res.json());
    // 16:00: today's morning doses are past. Napa: tonight + 4 days x 2. Seclo: 13 mornings.
    expect(body).toMatchObject({
      status: 'CONFIRMED',
      scheduledEventsCount: 9 + 13,
      firstDoseAt: '2026-11-22T21:30:00+06:00',
    });
    expect(body.prescriptionId).toMatch(/^pre_/);
    expect(body.banglaSummary).toBe(
      'আপনার প্রেসক্রিপশনের জন্য মোট ২টি ওষুধ শিডিউল করা হয়েছে। Napa Extra সকালে ও রাতে খাবারের পরে; Seclo সকালে খাবারের আগে।',
    );
    await h.app.close();
  });

  it('sends unschedulable items back with reasons and saves nothing', async () => {
    const { h, confirm, today } = await setup();
    const res = await confirm([NAPA, { ...SECLO, parsedPattern: '1+1+1 BD' }]);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toEqual({
      code: 'NEEDS_MANUAL_INPUT',
      details: [{ index: 1, reasons: ['FREQUENCY_CONFLICT'] }],
    });
    expect((await today('?days=14')).doses).toEqual([]);
    await h.app.close();
  });

  it('as-needed items are saved but schedule no doses', async () => {
    const { h, confirm } = await setup();
    const res = await confirm([{ ...SECLO, parsedPattern: 'SOS' }]);
    expect(res.json()).toMatchObject({ scheduledEventsCount: 0, firstDoseAt: null });
    expect(res.json().banglaSummary).toContain('Seclo প্রয়োজনে');
    await h.app.close();
  });

  it('refuses an unknown draft, a bad body, and an empty prescription', async () => {
    const { h, confirm, user, self } = await setup();
    expect((await confirm([NAPA], 'pre_nope')).statusCode).toBe(404);
    expect((await confirm([])).statusCode).toBe(400);
    const bad = await h.api(user, 'POST', '/prescriptions/new/confirm', { profileId: self.id });
    expect(bad.json().error.code).toBe('INVALID_INPUT');
    await h.app.close();
  });
});

describe('doses', () => {
  it('today lists the day in Dhaka time, and days widens it', async () => {
    const { h, confirm, today } = await setup();
    await confirm([NAPA, SECLO]);
    const day = todayDosesResponse.parse(await today());
    expect(day.date).toBe('2026-11-22');
    expect(day.doses).toHaveLength(1);
    expect(day.doses[0]).toMatchObject({
      dueAt: '2026-11-22T21:30:00+06:00',
      time: '09:30 PM',
      medicine: 'Napa Extra 500mg+65mg',
      form: 'Tablet',
      instructions: 'রাতে, খাবারের পরে',
      status: 'SCHEDULED',
      isCritical: true,
      takenAt: null,
    });
    const two = await today('?days=2');
    expect(two.doses.map((d: { dueAt: string }) => d.dueAt)).toEqual([
      '2026-11-22T21:30:00+06:00',
      '2026-11-23T07:30:00+06:00',
      '2026-11-23T08:30:00+06:00',
      '2026-11-23T21:30:00+06:00',
    ]);
    expect(
      (
        await h.api(
          await h.addUser('tel:x', { msisdn: '8801700000000' }),
          'GET',
          '/doses/today?days=99',
        )
      ).statusCode,
    ).toBe(400);
    await h.app.close();
  });

  it('taken on time, then the same tap again is harmless, and a skip after it is refused', async () => {
    const { h, confirm, today, act } = await setup();
    await confirm([NAPA]);
    const dose = (await today()).doses[0];

    const early = await act(dose.id, { action: 'TAKEN' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('DOSE_NOT_DUE');

    h.clock.now = dhaka('2026-11-22T21:40:00');
    const res = await act(dose.id, { action: 'TAKEN' });
    expect(doseActionResponse.parse(res.json())).toEqual({
      success: true,
      doseId: dose.id,
      newStatus: 'TAKEN',
      updatedAdherenceRate: 100,
    });
    expect((await act(dose.id, { action: 'TAKEN' })).json().newStatus).toBe('TAKEN');
    expect((await act(dose.id, { action: 'SKIP' })).json().error.code).toBe('DOSE_CLOSED');
    expect((await today()).doses[0]).toMatchObject({
      status: 'TAKEN',
      takenAt: '2026-11-22T21:40:00+06:00',
    });
    await h.app.close();
  });

  it('taken more than 30 minutes after due is taken late; missed doses lower adherence', async () => {
    const { h, confirm, today, act } = await setup();
    await confirm([NAPA]);
    h.clock.now = dhaka('2026-11-23T09:10:00'); // tonight's dose never answered; morning 40 min late
    // Today is the 23rd now: its first dose is the 08:30 one.
    const morning = (await today()).doses[0];
    expect(morning.dueAt).toBe('2026-11-23T08:30:00+06:00');
    const res = await act(morning.id, { action: 'TAKEN' });
    expect(res.json()).toMatchObject({ newStatus: 'TAKEN_LATE', updatedAdherenceRate: 50 });
    await h.app.close();
  });

  it('snooze keeps the due time; skip keeps out of adherence', async () => {
    const { h, confirm, today, act } = await setup();
    await confirm([NAPA]);
    h.clock.now = dhaka('2026-11-22T21:30:00');
    const dose = (await today()).doses[0];
    expect((await act(dose.id, { action: 'SNOOZE', snoozeMinutes: 3 })).statusCode).toBe(400);
    expect((await act(dose.id, { action: 'SNOOZE' })).json().newStatus).toBe('SNOOZED');
    expect((await today()).doses[0]).toMatchObject({
      status: 'SNOOZED',
      dueAt: '2026-11-22T21:30:00+06:00',
    });
    const skipped = await act(dose.id, { action: 'SKIP', skipReason: 'বমি ভাব' });
    expect(skipped.json()).toMatchObject({ newStatus: 'SKIPPED', updatedAdherenceRate: null });
    await h.app.close();
  });

  it('refuses unknown doses and doses of other people', async () => {
    const { h, confirm, today } = await setup();
    await confirm([NAPA]);
    const dose = (await today()).doses[0];
    const stranger = await h.addUser(OTHER, { msisdn: '8801711111111' });
    expect(
      (await h.api(stranger, 'POST', `/doses/${dose.id}/action`, { action: 'TAKEN' })).statusCode,
    ).toBe(404);
    expect(
      (await h.api(stranger, 'POST', '/doses/dose_nope/action', { action: 'TAKEN' })).statusCode,
    ).toBe(404);
    await h.app.close();
  });
});

describe('SMS reply codes (doseReply port)', () => {
  const mo = (message: string, sourceAddress = SUB) => ({
    version: '1.0',
    applicationId: 'APP_1',
    sourceAddress,
    message,
    requestId: nextId(),
    encoding: '0',
  });

  it('UPOSHOM 1 marks the latest due dose taken and replies in Bangla', async () => {
    const { h, confirm, today } = await setup();
    await confirm([NAPA]);
    h.clock.now = dhaka('2026-11-22T21:35:00');
    await h.callback('sms/receive', mo('UPOSHOM 1'));
    await settle(h);
    expect((await today()).doses[0].status).toBe('TAKEN');
    expect(h.applink.sendSms).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.applink.sendSms.mock.calls[0])).toContain('ধন্যবাদ');
    await h.app.close();
  });

  it('UPOSHOM 2 snoozes and UPOSHOM ৩ (Bangla digit) skips', async () => {
    const { h, confirm, today } = await setup();
    await confirm([NAPA]);
    h.clock.now = dhaka('2026-11-22T21:31:00');
    await h.callback('sms/receive', mo('UPOSHOM 2'));
    await settle(h);
    expect((await today()).doses[0].status).toBe('SNOOZED');
    await h.callback('sms/receive', mo('UPOSHOM ৩'));
    await settle(h);
    expect((await today()).doses[0].status).toBe('SKIPPED');
    await h.app.close();
  });

  it('with no dose due it says so, and changes nothing', async () => {
    const { h, confirm, today } = await setup();
    await confirm([NAPA]);
    await h.callback('sms/receive', mo('UPOSHOM 1')); // 16:00: tonight's dose is hours away
    await settle(h);
    expect((await today()).doses[0].status).toBe('SCHEDULED');
    expect(JSON.stringify(h.applink.sendSms.mock.calls[0])).toContain('কোনো ডোজ বাকি নেই');
    await h.app.close();
  });
});

describe('delete my data', () => {
  it('erases the circle, profiles and doses before the account goes', async () => {
    const { h, user, confirm } = await setup();
    await confirm([NAPA]);
    await h.app.domain.eraseUser(user.id);
    const fresh = (await h.api(user, 'GET', '/circles')).json();
    expect(fresh.profiles).toHaveLength(1);
    expect((await h.api(user, 'GET', '/doses/today?days=7')).json().doses).toEqual([]);
    await h.app.close();
  });
});
