import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../api/endpoints';
import { USE_MOCK } from '../api/config';

/**
 * Registers the Expo push token for caregiver alerts. Push is best effort: it needs FCM credentials
 * (google-services.json) and an EAS project id. Without them the SMS channel carries the alert, so a
 * failure here is silent by design (Master Plan section 11: "Push notifications, fall back to SMS").
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const Notifications = await import('expo-notifications');
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    if (!projectId && !USE_MOCK) return;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.devices.register(token.data);
  } catch {
    // SMS remains the fallback channel
  }
}
