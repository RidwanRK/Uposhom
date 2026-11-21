import { getNotifee } from './notifee';
import { handleReminderAction, type ReminderAction } from './reminders';

/**
 * Registered at app start (index.ts), before the UI mounts, so Taken / Snooze / Skip pressed on a
 * reminder work with the app closed. Foreground presses are handled in app/_layout.tsx.
 */
const n = getNotifee();
if (n) {
  n.default.onBackgroundEvent(async ({ type, detail }) => {
    if (type !== n.EventType.ACTION_PRESS) return;
    const id = detail.pressAction?.id;
    if (id === 'taken' || id === 'snooze' || id === 'skip') {
      await handleReminderAction(
        id as ReminderAction,
        detail.notification?.data as Record<string, unknown> | undefined,
      );
    }
  });
}
