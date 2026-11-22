import { describe, expect, it } from 'vitest';
import { ApplinkTransportError } from '@uposhom/applink-client';
import { smsSegments } from '../src/sms/format.js';
import { applinkError, fakeApplink, harness, ok, settle, SUB } from './platform.js';

const payload = (over: Record<string, unknown> = {}) => ({
  subscriberId: SUB,
  message: 'Time for your medicine. Reply UPOSHOM 1 when taken.',
  purpose: 'REMINDER',
  idempotencyKey: 'dose-1:stage-0',
  ...over,
});

type SendArgs = [string, string, object];

describe('outbound SMS through the queue', () => {
  it('sends, records the Applink requestId and stores no message body', async () => {
    const h = await harness();
    await h.app.services.sms.enqueue(payload({ deliveryReport: true }));
    await settle(h);

    expect(h.applink.sendSms).toHaveBeenCalledTimes(1);
    const [to, , options] = h.applink.sendSms.mock.calls[0] as unknown as SendArgs;
    expect(to).toBe(SUB);
    expect(options).toEqual({ deliveryStatusRequest: '1' });

    const row = await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0');
    expect(row).toMatchObject({ status: 'SUBMITTED', requestId: 'req-1', purpose: 'REMINDER' });
    expect(JSON.stringify(row)).not.toContain('medicine');
    await h.app.close();
  });

  it('asks for no delivery report, and sets no sender, unless told to', async () => {
    const h = await harness();
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    const options = (h.applink.sendSms.mock.calls[0] as unknown as SendArgs)[2];
    expect(options).toEqual({});
    await h.app.close();
  });

  it('never sends the same logical message twice', async () => {
    const h = await harness();
    await h.app.services.sms.enqueue(payload());
    await h.app.services.sms.enqueue(payload()); // duplicate while queued
    await settle(h);
    await h.app.services.sms.enqueue(payload()); // duplicate after it was sent
    await settle(h);
    expect(h.applink.sendSms).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('skips a suppressed number, including a message already queued when STOP arrived', async () => {
    const h = await harness();
    await h.app.services.sms.enqueue(payload());
    // STOP lands after the job was queued but before it ran.
    await h.stores.optOuts.suppress(
      { subscriberId: SUB, reason: 'STOP', source: 'SMS' },
      h.clock.now,
    );
    await settle(h);
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    expect((await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0'))?.status).toBe('SKIPPED');
    await h.app.close();
  });

  it('retries a transient rejection with backoff and then succeeds', async () => {
    let n = 0;
    const applink = fakeApplink({
      sendSms: async () => {
        if (++n === 1) throw applinkError('E1603');
        return ok({ requestId: 'req-2', destinationResponses: [{ statusCode: 'S1000' }] });
      },
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(n).toBe(2);
    expect(await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0')).toMatchObject({
      status: 'SUBMITTED',
      requestId: 'req-2',
    });
    await h.app.close();
  });

  it('gives up after three retries and records the failure', async () => {
    const applink = fakeApplink({
      sendSms: async () => {
        throw applinkError('E1318');
      },
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(applink.sendSms).toHaveBeenCalledTimes(4); // first try plus three retries
    expect(await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0')).toMatchObject({
      status: 'FAILED',
      applinkStatusCode: 'E1318',
    });
    await h.app.close();
  });

  it('does not re-send after a timeout: the message may have gone out', async () => {
    const applink = fakeApplink({
      sendSms: async () => {
        throw new ApplinkTransportError('timed out', 'sms-send');
      },
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(applink.sendSms).toHaveBeenCalledTimes(1);
    expect((await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0'))?.status).toBe('UNKNOWN');
    await h.app.close();
  });

  it('does not retry configuration errors', async () => {
    const applink = fakeApplink({
      sendSms: async () => {
        throw applinkError('E1313');
      },
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(applink.sendSms).toHaveBeenCalledTimes(1);
    expect((await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0'))?.applinkStatusCode).toBe(
      'E1313',
    );
    await h.app.close();
  });

  it('blocks a blacklisted number (E1342) from every later message', async () => {
    const applink = fakeApplink({
      sendSms: async () => {
        throw applinkError('E1342');
      },
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('BLOCKED');
    await h.app.services.sms.enqueue(payload({ idempotencyKey: 'dose-2:stage-0' }));
    await settle(h);
    expect(applink.sendSms).toHaveBeenCalledTimes(1);
    await h.app.close();
  });

  it('reads the per-recipient status, not only the top-level S1000', async () => {
    const applink = fakeApplink({
      sendSms: async () =>
        ok({
          requestId: 'req-3',
          destinationResponses: [{ statusCode: 'E1343', statusDetail: 'not whitelisted' }],
        }),
    });
    const h = await harness({ applink });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0')).toMatchObject({
      status: 'FAILED',
      applinkStatusCode: 'E1343',
    });
    await h.app.close();
  });

  it('fails closed, without crashing, when Applink is not configured yet', async () => {
    const h = await harness({ applink: undefined });
    await h.app.services.sms.enqueue(payload());
    await settle(h);
    expect(await h.stores.smsLog.findByIdempotencyKey('dose-1:stage-0')).toMatchObject({
      status: 'FAILED',
      applinkStatusCode: 'NOT_CONFIGURED',
    });
    expect(h.queue.deadLetters()).toHaveLength(0);
    await h.app.close();
  });
});

describe('SMS length', () => {
  it('counts Latin text as GSM and Bangla as UCS-2', () => {
    expect(smsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM', parts: 1 });
    expect(smsSegments('a'.repeat(161))).toEqual({ encoding: 'GSM', parts: 2 });
    expect(smsSegments('ওষুধ খাওয়ার সময়')).toEqual({ encoding: 'UCS2', parts: 1 });
    expect(smsSegments('ও'.repeat(71))).toEqual({ encoding: 'UCS2', parts: 2 });
    expect(smsSegments('ও'.repeat(70)).parts).toBe(1);
  });
});
