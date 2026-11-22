import { maskAddress } from '@uposhom/applink-client';
import type { UssdAction } from '../ports.js';
import type { ServiceDeps } from '../services/deps.js';
import type { UnregisterService } from '../subscription/unregister.js';

/** USSD sessions die in seconds on the network; ours expires after about two minutes. */
export const USSD_SESSION_TTL_MS = 120_000;
const MAX_INVALID = 2;
const MAX_SCREEN_LENGTH = 160;

export const SCREENS = {
  main: "Uposhom Health\n1. Today's medicines\n2. Mark taken\n3. Next appointment\n4. Alert my caregiver\n5. Stop service\n0. Exit",
  invalid: 'Invalid choice.\n',
  stopConfirm: 'Stop Uposhom service and SMS reminders?\n1. Yes, stop\n2. No, go back',
  stopped: 'Uposhom service stopped. You will get no more messages. Open the app to join again.',
  exit: 'Thank you. Stay healthy.',
  unknownUser: 'Welcome to Uposhom. Please sign up in the Uposhom app first, then dial again.',
  expired: 'Session expired. Please dial the code again.',
  tooManyInvalid: 'Too many invalid choices. Please dial the code again.',
  unavailable: 'Uposhom is busy. Please try again in a few minutes.',
} as const;

const ACTIONS: Record<string, UssdAction> = {
  '1': 'TODAY',
  '2': 'MARK_TAKEN',
  '3': 'NEXT_APPOINTMENT',
  '4': 'ALERT_CAREGIVER',
};

/** USSD screens are plain ASCII (encoding 440), at most 160 characters. Anything else is cut. */
export function toUssdText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = text.replace(/[^\x0a\x20-\x7e]/g, '?');
  return ascii.length <= MAX_SCREEN_LENGTH ? ascii : ascii.slice(0, MAX_SCREEN_LENGTH);
}

export interface UssdPayload {
  sessionId: string;
  sourceAddress: string;
  ussdOperation: 'mo-init' | 'mo-cont';
  message: string;
  requestId: string;
}

/**
 * The USSD menu. The HTTP answer to the callback is only an acknowledgement; every screen the user
 * sees is a separate POST /ussd/send echoing the platform's sessionId, with `mt-cont` to keep the
 * session open and `mt-fin` to close it (anything else leaves it hanging until the network
 * times out).
 */
export function createUssdHandler(deps: ServiceDeps, unregister: UnregisterService) {
  async function send(
    p: UssdPayload,
    text: string,
    operation: 'mt-cont' | 'mt-fin',
  ): Promise<void> {
    if (!deps.applink) {
      deps.log.warn({ sessionId: p.sessionId }, 'ussd screen not sent: Applink is not configured');
      return;
    }
    try {
      await deps.applink.sendUssd({
        sessionId: p.sessionId,
        destinationAddress: p.sourceAddress,
        message: toUssdText(text),
        operation,
      });
    } catch (err) {
      // No retry: a screen that arrives after the session timed out is useless.
      deps.log.error(
        { sessionId: p.sessionId, err: err instanceof Error ? err.name : 'error' },
        'ussd screen send failed',
      );
    }
    if (operation === 'mt-fin') await deps.stores.ussdSessions.delete(p.sessionId);
  }

  async function showMain(p: UssdPayload, invalidCount: number, prefix = ''): Promise<void> {
    await deps.stores.ussdSessions.put({
      sessionId: p.sessionId,
      subscriberId: p.sourceAddress,
      state: 'MAIN_MENU',
      invalidCount,
      expiresAt: new Date(deps.now().getTime() + USSD_SESSION_TTL_MS),
    });
    await send(p, prefix + SCREENS.main, 'mt-cont');
  }

  return async function handleUssd(p: UssdPayload): Promise<void> {
    const t = deps.now();
    const subscriber = maskAddress(p.sourceAddress);

    // Subscribers are matched by the opaque subscriber id, never by a typed number.
    const user = await deps.stores.users.findBySubscriberId(p.sourceAddress);
    if (!user) {
      deps.log.info({ sessionId: p.sessionId, subscriber }, 'ussd from unknown subscriber');
      return send(p, SCREENS.unknownUser, 'mt-fin');
    }

    if (p.ussdOperation === 'mo-init') return showMain(p, 0);

    const session = await deps.stores.ussdSessions.get(p.sessionId, t);
    if (!session) return send(p, SCREENS.expired, 'mt-fin');
    const choice = p.message.trim();

    if (session.state === 'STOP_CONFIRM') {
      if (choice === '1') {
        await unregister.optOut({ subscriberId: p.sourceAddress, source: 'USSD' });
        deps.log.info({ subscriber, sessionId: p.sessionId }, 'ussd STOP honoured');
        return send(p, SCREENS.stopped, 'mt-fin');
      }
      if (choice === '2') return showMain(p, 0);
      return invalid(p, session.invalidCount, SCREENS.stopConfirm, 'STOP_CONFIRM');
    }

    // MAIN_MENU
    if (choice === '0') return send(p, SCREENS.exit, 'mt-fin');
    if (choice === '5') {
      await deps.stores.ussdSessions.put({ ...session, state: 'STOP_CONFIRM', invalidCount: 0 });
      return send(p, SCREENS.stopConfirm, 'mt-cont');
    }
    const action = ACTIONS[choice];
    if (action) {
      // Slow work is deferred: the domain port answers fast and says the rest comes by SMS.
      const text = await deps.ports.ussdAction({ subscriberId: p.sourceAddress, action });
      return send(p, text, 'mt-fin');
    }
    return invalid(p, session.invalidCount, SCREENS.main, 'MAIN_MENU');
  };

  async function invalid(
    p: UssdPayload,
    invalidCount: number,
    screen: string,
    state: 'MAIN_MENU' | 'STOP_CONFIRM',
  ): Promise<void> {
    if (invalidCount + 1 >= MAX_INVALID) return send(p, SCREENS.tooManyInvalid, 'mt-fin');
    await deps.stores.ussdSessions.put({
      sessionId: p.sessionId,
      subscriberId: p.sourceAddress,
      state,
      invalidCount: invalidCount + 1,
      expiresAt: new Date(deps.now().getTime() + USSD_SESSION_TTL_MS),
    });
    return send(p, SCREENS.invalid + screen, 'mt-cont');
  }
}
