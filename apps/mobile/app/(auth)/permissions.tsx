import { Camera } from 'expo-camera';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Icon, type IconName } from '../../src/components/Icon';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useT } from '../../src/i18n';
import { requestNotificationPermission } from '../../src/notifications/reminders';
import { colors } from '../../src/theme/colors';
import { toBn } from '../../src/utils/bangla';

interface Step {
  key: 'notifications' | 'camera';
  icon: IconName;
}
const STEPS: Step[] = [
  { key: 'notifications', icon: 'bell-ring-outline' },
  { key: 'camera', icon: 'camera-outline' },
];

/**
 * Sign-up step 4: permissions, one at a time with a plain-Bangla reason (design.md 6.11).
 * Location is asked later, only when the pharmacy search needs it. Battery setup (Screen 17) follows.
 */
export default function Permissions() {
  const t = useT();
  const [i, setI] = useState(0);
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const step = STEPS[i] as Step;

  const next = () => {
    if (i + 1 < STEPS.length) setI(i + 1);
    else router.replace('/battery-setup?first=1');
  };

  const allow = async () => {
    setBusy(true);
    try {
      let ok = false;
      if (step.key === 'notifications')
        ok = Platform.OS === 'android' ? await requestNotificationPermission() : false;
      else ok = (await Camera.requestCameraPermissionsAsync()).granted;
      setGranted((g) => ({ ...g, [step.key]: ok }));
    } catch {
      setGranted((g) => ({ ...g, [step.key]: false }));
    } finally {
      setBusy(false);
    }
  };

  const done = granted[step.key];

  return (
    <Screen contentStyle={{ gap: 22, paddingTop: 40, alignItems: 'stretch' }}>
      <Text variant="caption" style={{ textAlign: 'center' }}>
        {t('auth.permissions.stepOf', { n: toBn(i + 1), total: toBn(STEPS.length) })}
      </Text>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <View
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: colors.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={step.icon} size={60} color="primary" />
        </View>
        <Text variant="headlineMedium" style={{ textAlign: 'center' }} accessibilityRole="header">
          {step.key === 'notifications'
            ? t('auth.permissions.notifications')
            : t('auth.permissions.camera')}
        </Text>
        <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
          {step.key === 'notifications'
            ? t('auth.permissions.notificationsWhy')
            : t('auth.permissions.cameraWhy')}
        </Text>
      </View>
      {done ? (
        <>
          <Text variant="titleMedium" style={{ textAlign: 'center', color: colors.taken }}>
            ✓ {t('auth.permissions.allowed')}
          </Text>
          <Button label={t('auth.permissions.continue')} onPress={next} />
        </>
      ) : (
        <>
          <Button label={t('auth.permissions.allow')} loading={busy} onPress={allow} />
          <Button label={t('auth.permissions.skip')} variant="ghost" onPress={next} />
        </>
      )}
    </Screen>
  );
}
