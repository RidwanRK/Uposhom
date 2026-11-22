import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { harness, nextId, settle, SUB } from './platform.js';
import { startMockApplink, type MockApplink } from './helpers.js';

/**
 * The real Applink client against scripts/mock-applink.mjs: every body the Day 2 flows build is
 * validated against the published contract, so a malformed request shows up here as BAD.
 */
let mock: MockApplink;
beforeAll(async () => {
  mock = await startMockApplink(18091);
});
afterAll(() => mock.stop());

describe('SMS flows against the Applink mock', () => {
  it('sends an SMS, takes its delivery report, and honours STOP', async () => {
    const h = await harness({ applink: mock.client() });
    await h.addUser();

    // Outbound SMS with a delivery report. The mock answers with its published sample requestId.
    await h.app.services.sms.enqueue({
      subscriberId: SUB,
      message: 'Time for your medicine. Reply UPOSHOM 1 when taken.',
      purpose: 'REMINDER',
      idempotencyKey: 'e2e-1',
      deliveryReport: true,
    });
    await settle(h);
    const row = await h.stores.smsLog.findByIdempotencyKey('e2e-1');
    expect(row).toMatchObject({ status: 'SUBMITTED', requestId: '101901031657410007' });

    await h.callback('sms/report', {
      destinationAddress: SUB,
      timeStamp: '20261122100000',
      requestId: '101901031657410007',
      deliveryStatus: 'DELIVERED',
    });
    await settle(h);
    expect((await h.stores.smsLog.findByRequestId('101901031657410007'))?.deliveryStatus).toBe(
      'DELIVERED',
    );

    // MO STOP by SMS: suppressed at once, then Applink Unregister.
    await h.callback('sms/receive', {
      version: '1.0',
      applicationId: 'APP_1',
      sourceAddress: SUB,
      message: 'STOP',
      requestId: nextId(),
      encoding: '0',
    });
    await settle(h);
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');

    expect(await h.deadLetterCount()).toBe(0);
    expect(await mock.badRequests()).toEqual([]);
    await h.app.close();
  });
});
