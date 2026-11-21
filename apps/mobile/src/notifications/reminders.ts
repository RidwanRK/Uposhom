import type { Dose } from '@uposhom/shared';
import { api } from '../api/endpoints';
import { cache } from '../db/cache';
import { tr } from '../i18n';
import { useSession } from '../store/session';
import { formatTimeBn } from '../utils/dates';
import { getNotifee } from './notifee';

/** Channel id fixed by Master Plan section 17 D. */
export const CHANNEL_ID = 'medication_reminders';
const SNOOZE_MINUTES = 15;
const HORIZON_MS = 48 * 60 * 60 * 1000;

export type ReminderAction = 'taken' | 'snooze' | 'skip';

export async function ensureChannel(): Promise<void> {
  const n = getNotifee();
  if (!n) return;
  await n.default.createChannel({
    id: CHANNEL_ID,
    name: tr('notif.channelName'),
    importance: n.AndroidImportance.HIGH,
    vibration: true,
    sound: 'default',
    bypassDnd: false,
  });
}

function buildNotification(
  n: NonNullable<ReturnType<typeof getNotifee>>,
  id: string,
  dose: Pick<Dose, 'id' | 'medicine' | 'medicineBn' | 'dueAt' | 'profileId'>,
  profileName?: string,
) {
  return {
    id,
    title: tr('notif.title'),
    body: `${formatTimeBn(dose.dueAt)} · ${dose.medicineBn ?? dose.medicine}${profileName ? ` (${profileName})` : ''}`,
    data: { doseId: dose.id, profileId: dose.profileId ?? '' },
    android: {
      channelId: CHANNEL_ID,
      importance: n.AndroidImportance.HIGH,
      category: n.AndroidCategory.ALARM,
      smallIcon: 'ic_launcher',
      pressAction: { id: 'default', launchActivity: 'default' },
      actions: [
        { title: tr('notif.taken'), pressAction: { id: 'taken' } },
        { title: tr('notif.snooze'), pressAction: { id: 'snooze' } },
        { title: tr('notif.skip'), pressAction: { id: 'skip' } },
      ],
    },
  };
}

/** Schedule one exact alarm. Idempotent: the same id replaces the earlier trigger. */
export async function scheduleDoseAlarm(
  dose: Pick<Dose, 'id' | 'medicine' | 'medicineBn' | 'dueAt' | 'profileId'>,
  profileName?: string,
  atMs?: number,
  idSuffix = '',
): Promise<void> {
  const n = getNotifee();
  if (!n) return;
  const timestamp = atMs ?? new Date(dose.dueAt).getTime();
  if (timestamp <= Date.now()) return;
  await n.default.createTriggerNotification(
    buildNotification(n, `${dose.id}${idSuffix}`, dose, profileName),
    {
      type: n.TriggerType.TIMESTAMP,
      timestamp,
      // Exact, allowed while the phone is idle (Doze). Needs the exact-alarm permission on Android 12+.
      alarmManager: { allowWhileIdle: true },
    },
  );
}

/**
 * Replace the on-device alarms with the server's upcoming dose events. The app only displays what the
 * server returned; it never computes a dose time itself. Notifee re-registers triggers after a reboot,
 * and this runs again every time the app opens or the schedule refreshes.
 */
export async function syncReminders(
  doses: Dose[],
  profileNames: Record<string, string> = {},
): Promise<void> {
  const n = getNotifee();
  if (!n) return;
  await ensureChannel();
  const now = Date.now();
  const upcoming = doses.filter(
    (d) =>
      (d.status === 'SCHEDULED' || d.status === 'SNOOZED') &&
      new Date(d.dueAt).getTime() > now &&
      new Date(d.dueAt).getTime() < now + HORIZON_MS,
  );
  const wanted = new Set(upcoming.map((d) => d.id));
  const existing = await n.default.getTriggerNotificationIds();
  const stale = existing.filter((id) => !id.includes(':') && !wanted.has(id));
  if (stale.length) await n.default.cancelTriggerNotifications(stale);
  await Promise.all(
    upcoming.map((d) => scheduleDoseAlarm(d, d.profileId ? profileNames[d.profileId] : undefined)),
  );
}

export async function cancelDoseAlarm(doseId: string): Promise<void> {
  const n = getNotifee();
  if (!n) return;
  await n.default.cancelTriggerNotifications([doseId, `${doseId}:snooze`]);
  await n.default.cancelNotification(doseId);
}

async function ensureSessionLoaded() {
  const s = useSession.getState();
  if (!s.hydrated) await s.hydrate();
}

/**
 * Taken / Snooze 15m / Skip pressed on a notification, in the foreground or with the app closed.
 * Calls the same dose action API as the in-app buttons. If the phone is offline the action is queued
 * in SQLite and sent on the next open.
 */
export async function handleReminderAction(
  action: ReminderAction,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const doseId = typeof data?.doseId === 'string' ? data.doseId : null;
  if (!doseId) return;
  await ensureSessionLoaded();
  const body =
    action === 'taken'
      ? ({ action: 'TAKEN' } as const)
      : action === 'snooze'
        ? ({ action: 'SNOOZE', snoozeMinutes: SNOOZE_MINUTES } as const)
        : ({ action: 'SKIP' } as const);

  const n = getNotifee();
  await n?.default.cancelNotification(doseId);
  try {
    await api.doses.act(doseId, body);
  } catch {
    await cache.enqueueAction(doseId, body);
  }
  if (action === 'taken' || action === 'skip') {
    await cancelDoseAlarm(doseId);
  }
  if (action === 'snooze') {
    // Ring again locally even if the server is unreachable.
    await scheduleDoseAlarm(
      {
        id: doseId,
        medicine: String(data?.medicine ?? ''),
        dueAt: new Date(Date.now() + SNOOZE_MINUTES * 60 * 1000).toISOString(),
        profileId: typeof data?.profileId === 'string' ? data.profileId : undefined,
      },
      undefined,
      Date.now() + SNOOZE_MINUTES * 60 * 1000,
      ':snooze',
    );
  }
}

/** Send actions taken while offline. Safe to call often. */
export async function flushPendingActions(): Promise<void> {
  const pending = await cache.pendingActions();
  for (const p of pending) {
    try {
      await api.doses.act(p.doseId, p.body);
      await cache.dropPending(p.id);
    } catch (e) {
      // keep it queued on network trouble, drop it if the server says it no longer applies
      if (
        e instanceof Error &&
        'status' in e &&
        typeof (e as { status: number }).status === 'number' &&
        (e as { status: number }).status >= 400
      ) {
        await cache.dropPending(p.id);
      } else {
        break;
      }
    }
  }
}

// ---- Permissions and battery setup (design.md Screen 17)

export interface ReminderHealth {
  supported: boolean;
  notifications: boolean;
  exactAlarms: boolean;
  batteryExempt: boolean;
}

export async function getReminderHealth(): Promise<ReminderHealth> {
  const n = getNotifee();
  if (!n)
    return { supported: false, notifications: false, exactAlarms: false, batteryExempt: false };
  const s = await n.default.getNotificationSettings();
  const batteryOptimised = await n.default.isBatteryOptimizationEnabled();
  return {
    supported: true,
    notifications:
      s.authorizationStatus === n.AuthorizationStatus.AUTHORIZED ||
      s.authorizationStatus === n.AuthorizationStatus.PROVISIONAL,
    exactAlarms: s.android.alarm === n.AndroidNotificationSetting.ENABLED,
    batteryExempt: !batteryOptimised,
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  const n = getNotifee();
  if (!n) return false;
  const s = await n.default.requestPermission();
  return s.authorizationStatus === n.AuthorizationStatus.AUTHORIZED;
}

export async function openAlarmSettings(): Promise<void> {
  await getNotifee()?.default.openAlarmPermissionSettings();
}

export async function openBatterySettings(): Promise<void> {
  await getNotifee()?.default.openBatteryOptimizationSettings();
}

/** Fire a sample reminder in 10 seconds so the person hears it before relying on it. */
export async function scheduleTestAlarm(): Promise<void> {
  await ensureChannel();
  await scheduleDoseAlarm(
    {
      id: 'test_alarm',
      medicine: tr('notif.testBody'),
      dueAt: new Date(Date.now() + 10000).toISOString(),
    },
    undefined,
    Date.now() + 10000,
  );
}
