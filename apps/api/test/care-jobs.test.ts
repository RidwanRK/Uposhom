import { describe, expect, it, vi } from 'vitest';
import { alertsResponse, tracesResponse, type ConfirmItem } from '@uposhom/shared';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import type { PushMessage, PushSender } from '../src/domain/push.js';
import { bnDate } from '../src/domain/care-jobs.js';
import { nextId, settle, OTHER, SUB } from './platform.js';
import { domainHarness } from './domain-harness.js';

// The harness clock starts 2026-11-22T10:00:00Z = 16:00 Dhaka, a Sunday.
const at = (local: string) => new Date(`${local}+06:00`);

const ITEM: ConfirmItem = {
  brandName: 'Metformin',
  dosageStrength: '500mg',
  form: 'Tablet',
  parsedPattern: '1+0+1',
  mealRelation: 'PC',
  durationDays: 30,
  isCritical: false,
  pillCount: 10, // two a day: covers 22 to 26 Nov, refill due on the 27th
};

async function setup() {
  const store = createMemoryDomainStore();
  const pushed: PushMessage[] = [];
  const push: PushSender = {
    async send(m) {
      pushed.push(...m);
      return m.map(() => ({ ok: true }) as const);
    },
  };
  const h = await domainHarness({ store, push });
  const patient = await h.addUser(SUB);
  const self = (await h.api(patient, 'GET', '/circles')).json().profiles[0];
  const sms = () =>
    h.applink.sendSms.mock.calls.map((c) => {
      const [to, text] = c as unknown as [string, string];
      return `${to === SUB ? 'patient' : to}: ${text}`;
    });
  const run = async (job: 'refills' | 'appointments' | 'digest', local: string) => {
    h.clock.now = at(local);
    const out = await h.app.careJobs[job]();
    await settle(h);
    return out;
  };
  const inbox = async (u = patient) =>
    alertsResponse.parse((await h.api(u, 'GET', '/alerts')).json()).alerts;
  return { h, store, patient, self, sms, run, inbox, pushed };
}

describe('refill reminders', () => {
  it('two days ahead: one notice to the patient and one SMS, never twice', async () => {
    const t = await setup();
    await t.h.api(t.patient, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [ITEM],
    });

    expect(await t.run('refills', '2026-11-24T09:00:00')).toEqual({ items: 0 }); // 27th is 3 days away
    expect(await t.run('refills', '2026-11-25T09:00:00')).toEqual({ items: 1 });
    await t.run('refills', '2026-11-26T09:00:00');
    expect(t.sms()).toEqual(['patient: উপশম: Metformin 500mg ২৭ নভেম্বর-এ শেষ হবে। রিফিল করে নিন।']);
    const alerts = await t.inbox();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: 'REFILL_DUE',
      title: 'ওষুধ শেষ হয়ে আসছে',
      profileId: t.self.id,
      acknowledged: false,
    });
    await t.h.app.close();
  });

  it('no pill count, or enough pills for the course: nothing', async () => {
    const t = await setup();
    await t.h.api(t.patient, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [
        { ...ITEM, pillCount: undefined },
        { ...ITEM, brandName: 'Losartan', pillCount: 100 },
      ],
    });
    expect(await t.run('refills', '2026-11-25T09:00:00')).toEqual({ items: 0 });
    await t.h.app.close();
  });
});

describe('follow-up appointments', () => {
  it('adds and lists them, refusing the past and empty titles', async () => {
    const t = await setup();
    const url = `/profiles/${t.self.id}/appointments`;
    const made = await t.h.api(t.patient, 'POST', url, {
      title: 'ডাক্তার দেখানো',
      dueAt: '2026-11-24T10:30:00+06:00',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      title: 'ডাক্তার দেখানো',
      dueAt: '2026-11-24T10:30:00+06:00',
      reminderState: 'PENDING',
    });
    const past = await t.h.api(t.patient, 'POST', url, {
      title: 'x',
      dueAt: '2026-11-20T10:00:00+06:00',
    });
    expect(past.json().error).toEqual({ code: 'INVALID_INPUT', message: 'DUE_AT' });
    const noZone = await t.h.api(t.patient, 'POST', url, {
      title: 'x',
      dueAt: '2026-11-24T10:00:00',
    });
    expect(noZone.json().error.message).toBe('DUE_AT');
    expect(
      (
        await t.h.api(t.patient, 'POST', url, { title: '  ', dueAt: '2026-11-24T10:00:00+06:00' })
      ).json().error.message,
    ).toBe('TITLE');
    expect((await t.h.api(t.patient, 'GET', url)).json().appointments).toHaveLength(1);

    const stranger = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    expect((await t.h.api(stranger, 'GET', url)).statusCode).toBe(404);
    await t.h.app.close();
  });

  it('reminds once, within the 24 hours before', async () => {
    const t = await setup();
    await t.h.api(t.patient, 'POST', `/profiles/${t.self.id}/appointments`, {
      title: 'ডাক্তার দেখানো',
      dueAt: '2026-11-24T10:30:00+06:00',
    });
    expect(await t.run('appointments', '2026-11-23T10:00:00')).toEqual({ reminded: 0 });
    expect(await t.run('appointments', '2026-11-23T10:45:00')).toEqual({ reminded: 1 });
    expect(await t.run('appointments', '2026-11-23T11:00:00')).toEqual({ reminded: 0 });
    expect(t.sms()).toEqual(['patient: উপশম: ফলো-আপ ডাক্তার দেখানো, ২৪ নভেম্বর ১০:৩০।']);
    expect((await t.inbox()).map((a) => a.type)).toEqual(['FOLLOW_UP']);
    const listed = (await t.h.api(t.patient, 'GET', `/profiles/${t.self.id}/appointments`)).json();
    expect(listed.appointments[0].reminderState).toBe('REMINDED');
    await t.h.app.close();
  });
});

describe('weekly caregiver digest', () => {
  it('Friday evening: the caregiver gets the week in one notice and one push; the patient does not', async () => {
    const t = await setup();
    const carer = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    await t.store.profiles.addLink({
      id: nextId(),
      userId: carer.id,
      profileId: t.self.id,
      role: 'CAREGIVER',
      isSecondaryCaregiver: false,
      createdAt: t.h.clock.now,
    });
    await t.h.api(t.patient, 'PUT', `/profiles/${t.self.id}`, { name: 'Rahim' });
    await t.h.api(t.patient, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [{ ...ITEM, durationDays: 7, pillCount: undefined }],
    });
    await t.h.api(carer, 'POST', '/devices', { expoPushToken: 'ExpoPushToken[carerphone000001]' });

    // Take every other dose on time, up to Friday evening.
    const doses = (await t.h.api(t.patient, 'GET', '/doses/today?days=6')).json().doses as Array<{
      id: string;
      dueAt: string;
    }>;
    const byFriday = doses.filter((d) => d.dueAt < '2026-11-27T20:00');
    for (const [i, d] of byFriday.entries()) {
      if (i % 2) continue;
      t.h.clock.now = new Date(d.dueAt);
      await t.h.api(t.patient, 'POST', `/doses/${d.id}/action`, { action: 'TAKEN' });
    }

    expect(await t.run('digest', '2026-11-27T20:00:00')).toEqual({ profiles: 1 });
    await t.run('digest', '2026-11-27T20:05:00'); // a re-run adds nothing
    const theirs = await t.inbox(carer);
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({
      type: 'WEEKLY_DIGEST',
      title: 'সাপ্তাহিক সারসংক্ষেপ',
      body: 'এই সপ্তাহে Rahim ৫০% ওষুধ সময়মতো খেয়েছেন।',
    });
    expect(t.pushed.map((m) => m.data['type'])).toEqual(['WEEKLY_DIGEST']);
    expect(await t.inbox()).toEqual([]);
    await t.h.app.close();
  });

  it('says how many were missed', async () => {
    const t = await setup();
    const carer = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    await t.store.profiles.addLink({
      id: nextId(),
      userId: carer.id,
      profileId: t.self.id,
      role: 'CAREGIVER',
      isSecondaryCaregiver: false,
      createdAt: t.h.clock.now,
    });
    await t.h.api(t.patient, 'POST', '/prescriptions/new/confirm', {
      profileId: t.self.id,
      items: [{ ...ITEM, durationDays: 2, pillCount: undefined }],
    });
    for (const m of ['2026-11-22T22:30:00', '2026-11-23T09:30:00']) {
      t.h.clock.now = at(m);
      await t.h.app.ladder.tick();
    }
    await t.run('digest', '2026-11-23T20:00:00');
    expect((await t.inbox(carer))[0]?.body).toBe(
      'এই সপ্তাহে আপনার পরিবারের সদস্য ০% ওষুধ সময়মতো খেয়েছেন। মিস: ২টি।',
    );
    await t.h.app.close();
  });
});

describe('admin traces', () => {
  it('admins only; newest first in the app shape; every read is audited', async () => {
    const t = await setup();
    const admin = await t.h.addUser(OTHER, { msisdn: '8801711111111' });
    const real = t.h.stores.users.findById.bind(t.h.stores.users);
    vi.spyOn(t.h.stores.users, 'findById').mockImplementation(async (id) => {
      const u = await real(id);
      return u && u.id === admin.id ? { ...u, isAdmin: true } : u;
    });

    t.h.clock.now = at('2026-11-22T17:00:00');
    await t.h.app.domain.recordTrace({
      channel: 'SMS',
      rootAgent: 'TriageAgent',
      inputPreview: 'x'.repeat(300),
      handoffs: [{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }],
      toolCalls: [{ name: 'getNextDose', durationMs: 12 }],
      durationMs: 840.4,
    });
    t.h.clock.now = at('2026-11-22T17:05:00');
    await t.h.app.domain.recordTrace({
      channel: 'APP',
      rootAgent: 'SymptomJournalAgent',
      handoffs: [],
      toolCalls: [],
      durationMs: 1200,
    });

    expect((await t.h.api(t.patient, 'GET', '/admin/traces')).statusCode).toBe(403);
    const res = tracesResponse.parse((await t.h.api(admin, 'GET', '/admin/traces')).json());
    expect(res.traces.map((x) => x.agent)).toEqual(['SymptomJournalAgent', 'TriageAgent']);
    expect(res.traces[1]).toMatchObject({
      createdAt: '2026-11-22T17:00:00+06:00',
      handoffs: [{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }],
      toolCalls: [{ name: 'getNextDose', durationMs: 12 }],
      latencyMs: 840,
    });
    expect(res.traces[1]!.inputPreview).toHaveLength(120);
    expect((await t.h.api(admin, 'GET', '/admin/traces?limit=1')).json().traces).toHaveLength(1);
    expect(await t.store.audit.listForActor(admin.id)).toHaveLength(2);
    expect(await t.store.audit.listForActor(t.patient.id)).toEqual([]);
    await t.h.app.close();
  });
});

describe('helpers', () => {
  it('bnDate', () => {
    expect(bnDate('2026-11-27')).toBe('২৭ নভেম্বর');
    expect(bnDate('2027-01-01')).toBe('১ জানুয়ারি');
  });
});
