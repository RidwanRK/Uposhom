import '../global.css';
import '../src/i18n';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaymentGateProvider } from '../src/hooks/usePaymentGate';
import {
  ensureChannel,
  flushPendingActions,
  handleReminderAction,
  type ReminderAction,
} from '../src/notifications/reminders';
import { getNotifee } from '../src/notifications/notifee';
import { registerPushToken } from '../src/notifications/push';
import { useSession } from '../src/store/session';
import { colors } from '../src/theme/colors';
import { fontFiles } from '../src/theme/fontFiles';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnReconnect: true } },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  const hydrated = useSession((s) => s.hydrated);
  const hydrate = useSession((s) => s.hydrate);
  const token = useSession((s) => s.accessToken);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && hydrated) {
      setReady(true);
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, hydrated]);

  // Foreground notification presses (Taken / Snooze / Skip, or tapping the reminder).
  useEffect(() => {
    const n = getNotifee();
    if (!n) return;
    void ensureChannel();
    return n.default.onForegroundEvent(({ type, detail }) => {
      if (type === n.EventType.ACTION_PRESS) {
        const id = detail.pressAction?.id;
        if (id === 'taken' || id === 'snooze' || id === 'skip') {
          void handleReminderAction(
            id as ReminderAction,
            detail.notification?.data as Record<string, unknown> | undefined,
          ).then(() => queryClient.invalidateQueries({ queryKey: ['doses'] }));
        }
      } else if (type === n.EventType.PRESS) {
        router.push('/');
      }
    });
  }, []);

  // Tapping a caregiver push opens the matching alerts inbox.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let remove: (() => void) | undefined;
    void import('expo-notifications').then((N) => {
      const sub = N.addNotificationResponseReceivedListener(() => router.push('/alerts'));
      remove = () => sub.remove();
    });
    return () => remove?.();
  }, []);

  // Signed in: register for push, and send any dose actions taken while offline.
  useEffect(() => {
    if (!token) return;
    void registerPushToken();
    void flushPendingActions();
  }, [token]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void flushPendingActions().then(() => queryClient.invalidateQueries());
      }
    });
    return () => sub.remove();
  }, []);

  useAuthGate(ready);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <PaymentGateProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: 'fade_from_bottom',
              }}
            />
          </PaymentGateProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Signed-out users are always sent to sign-up, whatever screen they were on. */
function useAuthGate(ready: boolean) {
  const token = useSession((s) => s.accessToken);
  const segments = useSegments();
  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/(auth)/account-type');
  }, [ready, token, segments]);
}
