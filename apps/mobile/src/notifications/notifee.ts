import { Platform } from 'react-native';

export type NotifeeModule = typeof import('@notifee/react-native');

let mod: NotifeeModule | null | undefined;

/**
 * Notifee is a native module (Android only here). Loading it lazily keeps the web preview and any
 * environment without the native build from crashing at import time.
 */
export function getNotifee(): NotifeeModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS !== 'android') {
    mod = null;
    return mod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@notifee/react-native') as NotifeeModule;
  } catch {
    mod = null;
  }
  return mod;
}
