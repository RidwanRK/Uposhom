import { describe, expect, it, vi } from 'vitest';
import type { ConfirmItem } from '@uposhom/shared';
import { createMemoryDomainStore } from '../src/domain/memory.js';
import {
  createExpoPushSender,
  isExpoPushToken,
  type PushMessage,
  type PushSender,
  type PushTicket,
} from '../src/domain/push.js';
import { nextId, settle, OTHER, SUB } from './platform.js';
import { domainHarness } from './domain-harness.js';

const TOKEN = 'ExponentPushToken[abcdefghij0123456789]';
const TOKEN2 = 'ExpoPushToken[zyxwvutsrq9876543210]';

/** A fake Expo: records what it was asked to send and answers with the given tickets. */
function fakeSender(answer: (m: PushMessage) => PushTicket = () => ({ ok: true })) {
  const sent: PushMessage[] = [];
  const sender: PushSender & { sent: PushMessage[]; fail: number } = {
    sent,
    fail: 0,
    async send(messages) {
      if (sender.fail > 0) {
        sender.fail--;
        throw new Error('expo down');
      }
      sent.push(...messages);
      return messages.map(answer);
    },
  };
  return sender;
}

describe('Expo push client', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const msg = (to: string): PushMessage => ({ to, title: 't', body: 'b', data: { doseId: 'd1' } });

  it('posts high-priority messages and reads one ticket per message', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        data: [
          { status: 'ok', id: 'x' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'big', details: { error: 'MessageTooBig' } },
        ],
      }),
    );
    const sender = createExpoPushSender({
      accessToken: 'secret',
      fetch: fetchImpl as typeof fetch,
    });
    const tickets = await sender.send([msg(TOKEN), msg(TOKEN2), msg(TOKEN)]);
    expect(tickets).toEqual([
      { ok: true },
      { ok: false, unregistered: true, error: 'DeviceNotRegistered' },
      { ok: false, unregistered: false, error: 'MessageTooBig' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)[0]).toEqual({
      ...msg(TOKEN),
      priority: 'high',
      sound: 'default',
      ttl: 3600,
    });
  });

  it('sends in batches of 100, and treats a missing ticket as an error', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string) as unknown[]).length;
      return json({ data: Array.from({ length: n - 1 }, () => ({ status: 'ok' })) });
    });
    const sender = createExpoPushSender({ fetch: fetchImpl as unknown as typeof fetch });
    const tickets = await sender.send(Array.from({ length: 150 }, () => msg(TOKEN)));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tickets.filter((t) => !t.ok)).toHaveLength(2);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('throws on an HTTP failure, so the queue retries', async () => {
    const sender = createExpoPushSender({
      fetch: (async () => json({}, 503)) as unknown as typeof fetch,
    });
    await expect(sender.send([msg(TOKEN)])).rejects.toThrow('expo push http 503');
  });

  it('recognises Expo push tokens', () => {
    expect(isExpoPushToken(TOKEN)).toBe(true);
    expect(isExpoPushToken(TOKEN2)).toBe(true);
    expect(isExpoPushToken('fcm:abc')).toBe(false);
    expect(isExpoPushToken('ExponentPushToken[short]')).toBe(false);
  });
});

describe('POST /devices', () => {
  it('registers a token, refuses anything else, and moves a token to whoever signs in on it', async () => {
    const store = createMemoryDomainStore();
    const h = await domainHarness({ store });
    const a = await h.addUser(SUB);
    const b = await h.addUser(OTHER, { msisdn: '8801711111111' });
    const reg = (u: typeof a, body: object) => h.api(u, 'POST', '/devices', body);

    expect((await reg(a, { expoPushToken: TOKEN, platform: 'android' })).json()).toEqual({
      success: true,
    });
    expect((await reg(a, { expoPushToken: TOKEN })).statusCode).toBe(200); // repeat is fine
    expect((await store.devices.listForUser(a.id)).map((d) => d.expoToken)).toEqual([TOKEN]);

    const bad = await reg(a, { expoPushToken: 'not-a-token' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toEqual({ code: 'INVALID_INPUT', message: 'PUSH_TOKEN' });
    expect((await reg(a, {})).statusCode).toBe(400);

    await reg(b, { expoPushToken: TOKEN });
    expect(await store.devices.listForUser(a.id)).toEqual([]);
    expect((await store.devices.listForUser(b.id)).map((d) => d.expoToken)).toEqual([TOKEN]);
    await h.app.close();
  });
});

describe('caregiver alerts by push', () => {
  const NAPA: ConfirmItem = {
    brandName: 'Napa',
    dosageStrength: '500mg',
    form: 'Tablet',
    parsedPattern: '1+0+1',
    mealRelation: 'PC',
    durationDays: 2,
    isCritical: true,
  };

  async function setup(sender = fakeSender(), withDevices = true) {
    const store = createMemoryDomainStore();
    const h = await domainHarness({ store, push: sender });
    vi.spyOn(h.app.services.subscriptions, 'isPremium').mockResolvedValue(true);
    const patient = await h.addUser(SUB);
    const carer = await h.addUser(OTHER, { msisdn: '8801711111111' });
    const self = (await h.api(patient, 'GET', '/circles')).json().profiles[0];
    await store.profiles.addLink({
      id: nextId(),
      userId: carer.id,
      profileId: self.id,
      role: 'CAREGIVER',
      isSecondaryCaregiver: false,
      createdAt: h.clock.now,
    });
    if (withDevices) {
      await h.api(carer, 'POST', '/devices', { expoPushToken: TOKEN });
      await h.api(carer, 'POST', '/devices', { expoPushToken: TOKEN2 });
      // The patient's own phone must not get the caregiver alert.
      await h.api(patient, 'POST', '/devices', {
        expoPushToken: 'ExpoPushToken[patientphone0001]',
      });
    }
    await h.api(patient, 'POST', '/prescriptions/new/confirm', {
      profileId: self.id,
      items: [NAPA],
    });
    const dose = (await h.api(patient, 'GET', '/doses/today')).json().doses[0];
    const tickAt = async (local: string) => {
      h.clock.now = new Date(`2026-11-22T${local}:00+06:00`);
      await h.app.ladder.tick();
      await settle(h);
    };
    return { h, store, sender, carer, self, dose, tickAt };
  }

  it('the caregiver’s phones get the T+30 alert once, with the dose in the data', async () => {
    const t = await setup();
    await t.tickAt('21:30');
    expect(t.sender.sent).toEqual([]); // the patient's reminder is SMS plus the phone's own alarm
    await t.tickAt('22:00');
    await t.tickAt('22:01');
    expect(t.sender.sent.map((m) => m.to)).toEqual([TOKEN, TOKEN2]);
    expect(t.sender.sent[0]).toEqual({
      to: TOKEN,
      title: 'জরুরি ওষুধ খাওয়া হয়নি',
      body: 'আপনার পরিবারের সদস্য জরুরি ওষুধ Napa 500mg (২১:৩০) এখনও খাওয়া হয়নি। অ্যাপে দেখুন।',
      data: { type: 'CAREGIVER_ALERT', doseId: t.dose.id, profileId: t.self.id, level: 'PRIMARY' },
    });
    await t.h.app.close();
  });

  it('forgets a token Expo no longer knows', async () => {
    const sender = fakeSender((m) =>
      m.to === TOKEN2
        ? { ok: false, unregistered: true, error: 'DeviceNotRegistered' }
        : { ok: true },
    );
    const t = await setup(sender);
    await t.tickAt('22:00');
    expect((await t.store.devices.listForUser(t.carer.id)).map((d) => d.expoToken)).toEqual([
      TOKEN,
    ]);
    await t.h.app.close();
  });

  it('retries when Expo cannot be reached', async () => {
    const sender = fakeSender();
    sender.fail = 1;
    const t = await setup(sender);
    await t.tickAt('22:00');
    expect(t.sender.sent.map((m) => m.to)).toEqual([TOKEN, TOKEN2]);
    await t.h.app.close();
  });

  it('without a registered phone the alert still goes by SMS', async () => {
    const t = await setup(fakeSender(), false);
    await t.tickAt('22:00');
    expect(t.sender.sent).toEqual([]);
    const to = t.h.applink.sendSms.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(to).toEqual([OTHER]);
    await t.h.app.close();
  });
});
