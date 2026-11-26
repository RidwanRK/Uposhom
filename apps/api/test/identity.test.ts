import { describe, expect, it, vi } from 'vitest';
import { harness, settle, SUB } from './platform.js';

/** Applink's samples use `tel:880...` in some places and `tel:+880...` in others. */
const PLUS = 'tel:+8801959979376';
const mo = (message: string, sourceAddress: string, requestId: string) => ({
  version: '1.0',
  applicationId: 'APP_1',
  sourceAddress,
  message,
  requestId,
  encoding: '0',
});

describe('a subscriber arriving in another address form is still the same person', () => {
  it('STOP from the plus form suppresses the id we stored, so queued messages really stop', async () => {
    const h = await harness();
    await h.addUser(SUB); // stored as tel:8801959979376
    await h.callback('sms/receive', mo('STOP', PLUS, 'id-1'));
    await settle(h);

    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP'); // the stored form
    expect(h.applink.unregister).toHaveBeenCalledWith(SUB); // Applink gets the id as we hold it

    await h.app.services.sms.enqueue({
      subscriberId: SUB,
      message: 'x',
      purpose: 'REMINDER',
      idempotencyKey: 'k',
    });
    await settle(h);
    expect(h.applink.sendSms).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('a dose reply from the plus form reaches the right user and is answered at the stored id', async () => {
    const doseReply = vi.fn(async () => ({ replyText: 'Thanks.' }));
    const h = await harness({ ports: { doseReply } });
    await h.addUser(SUB);
    await h.callback('sms/receive', mo('UPOSHOM 1', PLUS, 'id-2'));
    await settle(h);
    expect(doseReply).toHaveBeenCalledWith({ subscriberId: SUB, code: 'TAKEN', profileTag: null });
    expect((h.applink.sendSms.mock.calls[0] as unknown as [string])[0]).toBe(SUB);
    await h.app.close();
  });

  it('a subscription notification in the plus form updates the mirror row the gate reads', async () => {
    const h = await harness();
    await h.addUser(SUB);
    await h.callback('subscription/notify', {
      timeStamp: '20261122100000',
      subscriberId: PLUS,
      status: 'TEMPORARY_BLOCKED',
      applicationId: 'APP_1',
    });
    await settle(h);
    expect((await h.stores.subscriptions.get(SUB))?.status).toBe('TEMPORARY_BLOCKED');
    expect(await h.stores.subscriptions.get(PLUS)).toBeNull(); // no second, orphan row
    await h.app.close();
  });

  it('a subscription notification without a plus updates a stored plus-form subscriber id', async () => {
    const h = await harness();
    await h.addUser(PLUS);
    await h.callback('subscription/notify', {
      timeStamp: '20261122100000',
      subscriberId: SUB,
      status: 'REGISTERED',
      applicationId: 'APP_1',
    });
    await settle(h);
    expect((await h.stores.subscriptions.get(PLUS))?.status).toBe('REGISTERED');
    expect(await h.stores.subscriptions.get(SUB)).toBeNull();
    await h.app.close();
  });

  it('an unknown number is left exactly as given, and its STOP is still honoured', async () => {
    const h = await harness();
    await h.callback('sms/receive', mo('STOP', 'tel:+8801700000000', 'id-3'));
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor('tel:+8801700000000')).toBe('STOP');
    await h.app.close();
  });

  it('a masked or opaque id is never rewritten', async () => {
    const h = await harness();
    await h.addUser('tel:masked-AbC+123 x');
    await h.callback('sms/receive', mo('STOP', 'tel:masked-AbC+123 x', 'id-4'));
    await settle(h);
    expect(h.applink.unregister).toHaveBeenCalledWith('tel:masked-AbC+123 x');
    await h.app.close();
  });
});
