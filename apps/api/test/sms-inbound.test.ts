import { describe, expect, it, vi } from 'vitest';
import { parseMo } from '../src/sms/mo.js';
import { normaliseDeliveryStatus } from '../src/sms/report.js';
import { fakeApplink, harness, nextId, settle, SUB, OTHER, ok } from './platform.js';

const mo = (message: string, sourceAddress = SUB, requestId = nextId()) => ({
  version: '1.0',
  applicationId: 'APP_1',
  sourceAddress,
  message,
  requestId,
  encoding: '0',
});

describe('parseMo', () => {
  it.each([
    ['UPOSHOM 1', { kind: 'DOSE', code: 'TAKEN', profileTag: null }],
    ['  uposhom    2 ', { kind: 'DOSE', code: 'SNOOZE', profileTag: null }],
    ['3', { kind: 'DOSE', code: 'SKIP', profileTag: null }],
    ['UPOSHOM ১', { kind: 'DOSE', code: 'TAKEN', profileTag: null }],
    ['UPOSHOM 1 a', { kind: 'DOSE', code: 'TAKEN', profileTag: 'A' }],
    ['UPOSHOM 1 toolongtag', { kind: 'DOSE', code: 'TAKEN', profileTag: null }],
    ['STOP', { kind: 'STOP' }],
    ['uposhom stop', { kind: 'STOP' }],
    ['UNSUB', { kind: 'STOP' }],
    ['Off', { kind: 'STOP' }],
    ['HELP', { kind: 'HELP' }],
    ['UPOSHOM', { kind: 'HELP' }],
    ['', { kind: 'HELP' }],
    ['hello there', { kind: 'UNKNOWN' }],
    ['UPOSHOM 9', { kind: 'UNKNOWN' }],
  ])('%j', (text, expected) => {
    expect(parseMo(text, 'UPOSHOM')).toEqual(expected);
  });
});

describe('inbound SMS (MO)', () => {
  it('STOP from anyone is honoured: suppressed at once, Applink Unregister queued, later sends skipped', async () => {
    const h = await harness();
    await h.callback('sms/receive', mo('STOP', OTHER));
    await settle(h);

    expect(await h.stores.optOuts.suppressionFor(OTHER)).toBe('STOP');
    expect(h.applink.unregister).toHaveBeenCalledWith(OTHER);

    await h.app.services.sms.enqueue({
      subscriberId: OTHER,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'k1',
    });
    await settle(h);
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('keeps retrying Unregister until the status says UNREGISTERED, and the opt-out holds meanwhile', async () => {
    let n = 0;
    const applink = fakeApplink({
      unregister: async () => ok({ subscriptionStatus: ++n < 3 ? 'REGISTERED' : 'UNREGISTERED.' }),
    });
    const h = await harness({ applink });
    await h.callback('sms/receive', mo('uposhom stop'));
    await settle(h);
    expect(n).toBe(3); // the published sample's trailing dot is tolerated
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });

  it('a dose reply from a known subscriber goes to the domain port, and its reply text is SMSed back', async () => {
    const doseReply = vi.fn(async () => ({ replyText: 'Marked as taken. Thank you.' }));
    const h = await harness({ ports: { doseReply } });
    await h.addUser();
    await h.callback('sms/receive', mo('UPOSHOM 1 B'));
    await settle(h);

    expect(doseReply).toHaveBeenCalledWith({ subscriberId: SUB, code: 'TAKEN', profileTag: 'B' });
    expect(h.applink.sendSms).toHaveBeenCalledTimes(1);
    expect((h.applink.sendSms.mock.calls[0] as unknown as [string, string])[1]).toBe(
      'Marked as taken. Thank you.',
    );
    await h.app.close();
  });

  it('stays silent when the domain has no reply text', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('sms/receive', mo('UPOSHOM 2'));
    await settle(h);
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('ignores dose replies and help requests from unknown numbers: no reply, no relay', async () => {
    const doseReply = vi.fn(async () => ({ replyText: 'should not happen' }));
    const h = await harness({ ports: { doseReply } });
    await h.callback('sms/receive', mo('UPOSHOM 1', OTHER));
    await h.callback('sms/receive', mo('HELP', OTHER));
    await settle(h);
    expect(doseReply).not.toHaveBeenCalled();
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('answers HELP and unrecognised text from a known subscriber with the usage line', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('sms/receive', mo('what is this'));
    await settle(h);
    const text = (h.applink.sendSms.mock.calls[0] as unknown as [string, string])[1];
    expect(text).toContain('UPOSHOM 1');
    expect(text).toContain('STOP');
    expect(text).not.toContain('what is this'); // never echo user content back
    await h.app.close();
  });

  it('processes a redelivered MO once', async () => {
    const doseReply = vi.fn(async () => ({ replyText: null }));
    const h = await harness({ ports: { doseReply } });
    await h.addUser();
    const same = mo('UPOSHOM 1', SUB, 'dup-1');
    await h.callback('sms/receive', same);
    await h.callback('sms/receive', same);
    await settle(h);
    expect(doseReply).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('cannot be used to charge or subscribe: only dose replies and opt-out exist', async () => {
    const h = await harness();
    await h.addUser();
    for (const text of ['REGISTER', 'SUBSCRIBE', 'PAY 500', 'DELETE']) {
      await h.callback('sms/receive', mo(text));
    }
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
    await h.app.close();
  });
});

const report = (requestId: string, deliveryStatus: string) => ({
  destinationAddress: SUB,
  timeStamp: '20261122100000',
  requestId,
  deliveryStatus,
});

async function sentMessage(
  h: Awaited<ReturnType<typeof harness>>,
  key: string,
  requestId: string,
  extra = {},
) {
  h.applink.sendSms.mockResolvedValueOnce(
    ok({ requestId, destinationResponses: [{ statusCode: 'S1000' }] }) as never,
  );
  await h.app.services.sms.enqueue({
    subscriberId: SUB,
    message: 'x',
    purpose: 'REMINDER',
    idempotencyKey: key,
    deliveryReport: true,
    ...extra,
  });
  await settle(h);
}

describe('delivery reports', () => {
  it('normalises SMPP spellings', () => {
    expect(normaliseDeliveryStatus('DELIVRD')).toBe('DELIVERED');
    expect(normaliseDeliveryStatus('undeliv')).toBe('UNDELIVERABLE');
    expect(normaliseDeliveryStatus('ACCEPTD')).toBe('ACCEPTED');
    expect(normaliseDeliveryStatus('REJECTD')).toBe('REJECTED');
    expect(normaliseDeliveryStatus('???')).toBe('UNKNOWN');
  });

  it('applies the latest status per requestId and never goes backwards', async () => {
    const h = await harness();
    await sentMessage(h, 'm1', 'r-100');
    const status = async () => (await h.stores.smsLog.findByRequestId('r-100'))?.deliveryStatus;

    await h.callback('sms/report', report('r-100', 'ACCEPTED'));
    await settle(h);
    expect(await status()).toBe('ACCEPTED');

    await h.callback('sms/report', report('r-100', 'DELIVRD'));
    await settle(h);
    expect(await status()).toBe('DELIVERED');

    await h.callback('sms/report', report('r-100', 'ACCEPTED')); // late and out of order
    await settle(h);
    expect(await status()).toBe('DELIVERED');
    await h.app.close();
  });

  it('acknowledges and discards a report for a message we never sent', async () => {
    const h = await harness();
    const res = await h.callback('sms/report', report('nobody-sent-this', 'DELIVERED'));
    expect(res).toEqual({ statusCode: 'S1000', statusDetail: 'Success' });
    await settle(h);
    expect(await h.deadLetterCount()).toBe(0);
    await h.app.close();
  });

  it('tells the domain about a failed reminder, with its critical flag', async () => {
    const onSmsDeliveryFailure = vi.fn(async () => undefined);
    const h = await harness({ ports: { onSmsDeliveryFailure } });
    await sentMessage(h, 'crit-1', 'r-200', { critical: true });
    await h.callback('sms/report', report('r-200', 'EXPIRED'));
    await settle(h);
    expect(onSmsDeliveryFailure).toHaveBeenCalledWith({
      subscriberId: SUB,
      purpose: 'REMINDER',
      critical: true,
      requestId: 'r-200',
    });
    await h.app.close();
  });

  it('marks a number dead after repeated UNDELIVERABLE and stops messaging it', async () => {
    const h = await harness();
    for (let i = 1; i <= 3; i++) {
      await sentMessage(h, `d${i}`, `r-30${i}`);
      h.clock.now = new Date(h.clock.now.getTime() + 1000);
      await h.callback('sms/report', report(`r-30${i}`, 'UNDELIVERABLE'));
      await settle(h);
    }
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('DEAD_NUMBER');

    await h.app.services.sms.enqueue({
      subscriberId: SUB,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'after-dead',
    });
    await settle(h);
    expect((await h.stores.smsLog.findByIdempotencyKey('after-dead'))?.status).toBe('SKIPPED');
    await h.app.close();
  });

  it('does not mark a number dead if a delivery succeeded in between', async () => {
    const h = await harness();
    const outcomes = ['UNDELIVERABLE', 'DELIVERED', 'UNDELIVERABLE'];
    for (const [i, outcome] of outcomes.entries()) {
      await sentMessage(h, `e${i}`, `r-40${i}`);
      h.clock.now = new Date(h.clock.now.getTime() + 1000);
      await h.callback('sms/report', report(`r-40${i}`, outcome));
      await settle(h);
    }
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
    await h.app.close();
  });
});
