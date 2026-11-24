import { Linking } from 'react-native';

/**
 * Opens this app's page in Android Settings. Needed once someone has chosen "Don't allow" twice
 * (or "don't ask again"): Android then answers every request with "denied" without showing a
 * dialog, and the only way back is the Permissions page in Settings.
 */
export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Nothing more we can do; the on-screen text says where to go.
  }
}
