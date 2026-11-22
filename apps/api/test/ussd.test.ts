import { describe, expect, it, vi } from 'vitest';
import { SCREENS, USSD_SESSION_TTL_MS, toUssdText } from '../src/ussd/menu.js';
import { harness, nextId, settle, SUB, OTHER } from './platform.js';

const ussd = (
  message: string,
  op: 'mo-init' | 'mo-cont' = 'mo-cont',
  sessionId = 's-1',
  sourceAddress = SUB,
) => ({
  version: '1.0',
  applicationId: 'APP_1',
  message,
  requestId: nextId(),
  sessionId,
  ussdOperation: op,
  sourceAddress,
  encoding: '440',
});

type Sent = { sessionId: string; destinationAddress: string; message: string; operation: string };
const sent = (h: Awaited<ReturnType<typeof harness>>): Sent[] =>
  h.applink.sendUssd.mock.calls.map((c) => (c as unknown as [Sent])[0]);

describe('USSD menu', () => {
  it('shows the main menu on dial and keeps the session open (mt-cont, echoing the sessionId)', async () => {
    const h = await harness();
    await h.addUser();
    expect(await h.callback('ussd/receive', ussd('*195#', 'mo-init'))).toEqual({
      statusCode: 'S1000',
      statusDetail: 'Success',
    });
    await settle(h);

    expect(sent(h)).toEqual([
      { sessionId: 's-1', destinationAddress: SUB, message: SCREENS.main, operation: 'mt-cont' },
    ]);
    expect(await h.stores.ussdSessions.get('s-1', h.clock.now)).toMatchObject({
      state: 'MAIN_MENU',
    });
    await h.app.close();
  });

  it('tells an unknown number to sign up, and closes the session', async () => {
    const h = await harness();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init', 's-2', OTHER));
    await settle(h);
    expect(sent(h)).toEqual([
      {
        sessionId: 's-2',
        destinationAddress: OTHER,
        message: SCREENS.unknownUser,
        operation: 'mt-fin',
      },
    ]);
    await h.app.close();
  });

  it.each([
    ['1', 'TODAY'],
    ['2', 'MARK_TAKEN'],
    ['3', 'NEXT_APPOINTMENT'],
    ['4', 'ALERT_CAREGIVER'],
  ])(
    'option %s asks the domain for %s and ends the session with the answer',
    async (choice, action) => {
      const ussdAction = vi.fn(async () => 'Your next dose is at 8 AM.');
      const h = await harness({ ports: { ussdAction } });
      await h.addUser();
      await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
      await h.callback('ussd/receive', ussd(choice));
      await settle(h);

      expect(ussdAction).toHaveBeenCalledWith({ subscriberId: SUB, action });
      expect(sent(h).at(-1)).toMatchObject({
        message: 'Your next dose is at 8 AM.',
        operation: 'mt-fin',
      });
      expect(await h.stores.ussdSessions.get('s-1', h.clock.now)).toBeNull();
      await h.app.close();
    },
  );

  it('sanitises domain text to plain ASCII and cuts it to 160 characters', async () => {
    const ussdAction = vi.fn(async () => 'ওষুধ ' + 'a'.repeat(300));
    const h = await harness({ ports: { ussdAction } });
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await h.callback('ussd/receive', ussd('1'));
    await settle(h);
    const text = sent(h).at(-1)?.message ?? '';
    expect(text.length).toBe(160);
    expect(text).toMatch(/^[\n -~]+$/);
    await h.app.close();
  });

  it('exits on 0 with a goodbye', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await h.callback('ussd/receive', ussd('0'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.exit, operation: 'mt-fin' });
    await h.app.close();
  });

  it('stops the service in two steps: confirm, then opt out and Unregister', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await h.callback('ussd/receive', ussd('5'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.stopConfirm, operation: 'mt-cont' });
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull(); // not yet

    await h.callback('ussd/receive', ussd('1'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.stopped, operation: 'mt-fin' });
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBe('STOP');
    expect(h.applink.unregister).toHaveBeenCalledWith(SUB);
    await h.app.close();
  });

  it('"No, go back" returns to the main menu without opting out', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await h.callback('ussd/receive', ussd('5'));
    await h.callback('ussd/receive', ussd('2'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.main, operation: 'mt-cont' });
    expect(await h.stores.optOuts.suppressionFor(SUB)).toBeNull();
    expect(h.applink.unregister).not.toHaveBeenCalled();
    await h.app.close();
  });

  it('re-prompts once on an invalid choice, then ends the session', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await h.callback('ussd/receive', ussd('9'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({
      message: SCREENS.invalid + SCREENS.main,
      operation: 'mt-cont',
    });
    await h.callback('ussd/receive', ussd('abc'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.tooManyInvalid, operation: 'mt-fin' });
    await h.app.close();
  });

  it('closes a reply that arrives with no live session (never leaves it hanging)', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('1', 'mo-cont', 'never-started'));
    await settle(h);
    expect(sent(h)).toEqual([
      {
        sessionId: 'never-started',
        destinationAddress: SUB,
        message: SCREENS.expired,
        operation: 'mt-fin',
      },
    ]);
    await h.app.close();
  });

  it('expires the session after about two minutes', async () => {
    const h = await harness();
    await h.addUser();
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await settle(h);
    h.clock.now = new Date(h.clock.now.getTime() + USSD_SESSION_TTL_MS + 1000);
    await h.callback('ussd/receive', ussd('1'));
    await settle(h);
    expect(sent(h).at(-1)).toMatchObject({ message: SCREENS.expired, operation: 'mt-fin' });
    await h.app.close();
  });

  it('survives a failed screen send without retrying it', async () => {
    const h = await harness();
    await h.addUser();
    h.applink.sendUssd.mockRejectedValueOnce(new Error('network'));
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await settle(h);
    expect(h.applink.sendUssd).toHaveBeenCalledTimes(1);
    expect(h.queue.deadLetters()).toHaveLength(0);
    await h.app.close();
  });

  it('does nothing, and does not crash, before Applink credentials exist', async () => {
    const h = await harness({ applink: undefined });
    await h.callback('ussd/receive', ussd('*195#', 'mo-init'));
    await settle(h);
    expect(h.queue.deadLetters()).toHaveLength(0);
    await h.app.close();
  });
});

describe('USSD screens', () => {
  it('are plain ASCII and at most 160 characters, including the re-prompt variants', () => {
    const screens = [
      ...Object.values(SCREENS),
      SCREENS.invalid + SCREENS.main,
      SCREENS.invalid + SCREENS.stopConfirm,
    ];
    for (const s of screens) {
      expect(s.length, s).toBeLessThanOrEqual(160);
      expect(s).toMatch(/^[\n -~]+$/);
      expect(toUssdText(s)).toBe(s);
    }
  });
});
