import { describe, expect, it, vi } from 'vitest';
import { alertsResponse, type ConfirmItem } from '@uposhom/shared';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import type { UserRecord } from '../src/stores/types.js';
import { harness, nextId, settle, OTHER, SUB } from './platform.js';

// Harness clock starts 2026-11-22T10:00:00Z = 16:00 Dhaka. Napa 1+0+1 PC is due 21:30 tonight.
const at = (hhmm: string) => new Date(`2026-11-22T${hhmm}:00+06:00`);
const SECOND = 'tel:8801722222222';

const NAPA: ConfirmItem = {
  brandName: 'Napa Extra',
  dosageStrength: '500mg',
  form: 'Tablet',
  parsedPattern: '1+0+1',
  mealRelation: 'PC',
  durationDays: 3,
  isCritical: true,
};

async function setup(opts: { premium?: boolean; critical?: boolean; secondary?: boolean } = {}) {
  const store = createMemoryDomainStore();
  const h = await harness({ realDomain: true, domain: store });
  vi.spyOn(h.app.services.subscriptions, 'isPremium').mockResolvedValue(opts.premium ?? true);
  const patient = await h.addUser(SUB);
  const carer = await h.addUser(OTHER, { msisdn: '8801711111111' });
  const backup = await h.addUser(SECOND, { msisdn: '8801722222222' });

  const self = (await h.api(patient, 'GET', '/circles')).json().profiles[0];
  const link = async (user: UserRecord, isSecondaryCaregiver: boolean) =>
    store.profiles.addLink({
      id: nextId(),
      userId: user.id,
      profileId: self.id,
      role: 'CAREGIVER',
      isSecondaryCaregiver,
      createdAt: h.clock.now,
    });
  await link(carer, false);
  if (opts.secondary !== false) await link(backup, true);

  await h.api(patient, 'POST', '/prescriptions/new/confirm', {
    profileId: self.id,
    items: [{ ...NAPA, isCritical: opts.critical ?? true }],
  });
  const dose = (await h.api(patient, 'GET', '/doses/today')).json().doses[0];

  /** Moves the clock, runs one ladder pass, lets the SMS queue drain. */
  const tickAt = async (hhmm: string) => {
    h.clock.now = at(hhmm);
    await h.app.ladder.tick();
    await settle(h);
  };
  /** Every SMS so far as "to: first words". */
  const sent = () =>
    h.applink.sendSms.mock.calls.map((c) => {
      const [to, text] = c as unknown as [string, string];
      const who = to === SUB ? 'patient' : to === OTHER ? 'carer' : to === SECOND ? 'backup' : to;
      return `${who}: ${text.includes('খাওয়ার সময়') ? 'reminder' : text.includes('জরুরি') ? 'alert' : text}`;
    });
  const status = async () =>
    (await h.api(patient, 'GET', '/doses/today')).json().doses[0].status as string;
  return { h, store, patient, carer, backup, self, dose, tickAt, sent, status };
}

describe('the ladder on stored doses', () => {
  it('critical: reminder, repeat, caregiver at T+30, secondary at T+50, missed at T+70', async () => {
    const t = await setup();
    await t.tickAt('21:29');
    expect(t.sent()).toEqual([]);
    await t.tickAt('21:30');
    await t.tickAt('21:45');
    await t.tickAt('22:00');
    expect(t.sent()).toEqual(['patient: reminder', 'patient: reminder', 'carer: alert']);
    await t.tickAt('22:20');
    expect(t.sent().at(-1)).toBe('backup: alert');
    await t.tickAt('22:39');
    expect(await t.status()).toBe('SCHEDULED');
    await t.tickAt('22:40');
    expect(await t.status()).toBe('MISSED');
    expect(t.sent()).toHaveLength(4);

    // The patient's own card shows the missed critical dose; the carer's inbox shows the alert.
    const circle = (await t.h.api(t.patient, 'GET', '/circles')).json();
    expect(circle.profiles[0].status).toBe('MISSED_CRITICAL');
    const inbox = alertsResponse.parse((await t.h.api(t.carer, 'GET', '/alerts')).json());
    expect(inbox.alerts).toHaveLength(1);
    expect(inbox.alerts[0]).toMatchObject({
      type: 'MISSED_DOSE',
      doseId: t.dose.id,
      medicine: 'Napa Extra 500mg',
      dueAt: '2026-11-22T21:30:00+06:00',
      acknowledged: false,
    });
    await t.h.app.close();
  });

  it('the reminder text carries the reply codes with the keyword', async () => {
    const t = await setup();
    await t.tickAt('21:30');
    const [, text] = t.h.applink.sendSms.mock.calls[0] as unknown as [string, string];
    expect(text).toBe(
      'উপশম: Napa Extra 500mg খাওয়ার সময় (২১:৩০)। খেলে UPOSHOM 1, পরে UPOSHOM 2, বাদ UPOSHOM 3',
    );
    await t.h.app.close();
  });

  it('a second pass at the same minute sends nothing again', async () => {
    const t = await setup();
    await t.tickAt('21:30');
    await t.tickAt('21:30');
    await t.tickAt('22:00');
    await t.tickAt('22:00');
    expect(t.sent()).toEqual(['patient: reminder', 'carer: alert']);
    await t.h.app.close();
  });

  it('a caregiver acknowledging stops the secondary alert', async () => {
    const t = await setup();
    await t.tickAt('22:00');
    const ack = await t.h.api(t.carer, 'POST', `/doses/${t.dose.id}/acknowledge`);
    expect(ack.json()).toEqual({ success: true });
    await t.tickAt('22:20');
    await t.tickAt('22:40');
    expect(t.sent()).toEqual(['carer: alert']);
    expect(await t.status()).toBe('MISSED');
    const inbox = (await t.h.api(t.carer, 'GET', '/alerts')).json();
    expect(inbox.alerts[0]).toMatchObject({ acknowledged: true });
    await t.h.app.close();
  });

  it('taken late after the caregiver alert stops everything', async () => {
    const t = await setup();
    await t.tickAt('22:00');
    t.h.clock.now = at('22:10');
    const res = await t.h.api(t.patient, 'POST', `/doses/${t.dose.id}/action`, { action: 'TAKEN' });
    expect(res.json().newStatus).toBe('TAKEN_LATE');
    await t.tickAt('22:20');
    await t.tickAt('23:00');
    expect(t.sent()).toEqual(['carer: alert']);
    expect(await t.status()).toBe('TAKEN_LATE');
    await t.h.app.close();
  });

  it('not critical: reminder, repeat, missed at T+30, no caregiver alert', async () => {
    const t = await setup({ critical: false });
    for (const m of ['21:30', '21:45', '22:00', '22:20', '22:40']) await t.tickAt(m);
    expect(t.sent()).toEqual(['patient: reminder', 'patient: reminder']);
    expect(await t.status()).toBe('MISSED');
    expect((await t.h.api(t.carer, 'GET', '/alerts')).json().alerts).toEqual([]);
    await t.h.app.close();
  });

  it('Free tier: a critical dose gets no caregiver alert', async () => {
    const t = await setup({ premium: false });
    for (const m of ['21:30', '21:45', '22:00', '22:20']) await t.tickAt(m);
    expect(t.sent()).toEqual(['patient: reminder', 'patient: reminder']);
    expect(await t.status()).toBe('MISSED');
    await t.h.app.close();
  });

  it('no secondary caregiver: missed at T+70 after the first alert', async () => {
    const t = await setup({ secondary: false });
    for (const m of ['22:00', '22:20', '22:39']) await t.tickAt(m);
    expect(await t.status()).toBe('SCHEDULED');
    await t.tickAt('22:40');
    expect(await t.status()).toBe('MISSED');
    expect(t.sent()).toEqual(['carer: alert']);
    await t.h.app.close();
  });

  it('snooze restarts the ladder from the end of the snooze', async () => {
    const t = await setup();
    await t.tickAt('21:30');
    t.h.clock.now = at('21:32');
    await t.h.api(t.patient, 'POST', `/doses/${t.dose.id}/action`, { action: 'SNOOZE' });
    await t.tickAt('21:46');
    expect(t.sent()).toEqual(['patient: reminder']);
    await t.tickAt('21:47');
    expect(t.sent()).toEqual(['patient: reminder', 'patient: reminder']);
    await t.tickAt('22:17');
    expect(t.sent().at(-1)).toBe('carer: alert');
    await t.h.app.close();
  });

  it('a bounced reminder for a critical dose alerts the caregiver at once', async () => {
    const t = await setup();
    await t.tickAt('21:30');
    t.h.clock.now = at('21:33');
    await t.h.callback('sms/report', {
      destinationAddress: SUB,
      requestId: 'req-1',
      deliveryStatus: 'UNDELIVERABLE',
      timeStamp: '20261122153300',
    });
    await settle(t.h);
    expect(t.sent()).toEqual(['patient: reminder', 'carer: alert']);
    await t.h.app.close();
  });

  it('an unknown dose cannot be acknowledged, nor someone else’s', async () => {
    const t = await setup();
    const stranger = await t.h.addUser('tel:8801733333333', { msisdn: '8801733333333' });
    expect((await t.h.api(stranger, 'POST', `/doses/${t.dose.id}/acknowledge`)).statusCode).toBe(
      404,
    );
    expect((await t.h.api(t.carer, 'POST', '/doses/dose_none/acknowledge')).statusCode).toBe(404);
    await t.h.app.close();
  });
});

describe('SMS reply after a snooze or alert still works', () => {
  it('UPOSHOM 1 during the caregiver alert window records taken late', async () => {
    const t = await setup();
    await t.tickAt('22:00');
    t.h.clock.now = at('22:05');
    await t.h.callback('sms/receive', {
      version: '1.0',
      applicationId: 'APP_1',
      sourceAddress: SUB,
      message: 'UPOSHOM 1',
      requestId: nextId(),
      encoding: '0',
    });
    await settle(t.h);
    expect(await t.status()).toBe('TAKEN_LATE');
    await t.tickAt('22:20');
    expect(t.sent().filter((s) => s.startsWith('backup'))).toEqual([]);
    await t.h.app.close();
  });
});
