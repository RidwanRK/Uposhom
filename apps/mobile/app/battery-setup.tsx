import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Header } from '../src/components/Header';
import { Icon } from '../src/components/Icon';
import { Banner } from '../src/components/Misc';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useT } from '../src/i18n';
import {
  getReminderHealth,
  openAlarmSettings,
  openBatterySettings,
  requestNotificationPermission,
  scheduleTestAlarm,
  type ReminderHealth,
} from '../src/notifications/reminders';
import { useSession } from '../src/store/session';
import { colors } from '../src/theme/colors';

type StepId = 'notifications' | 'exactAlarms' | 'batteryExempt';

/**
 * Battery & Notification Setup (design.md Screen 17). Reminders must fire with the app closed and after
 * a restart. Not skippable on first run: every step has to be tried before "finish" unlocks, but the
 * person is told that SMS reminders keep working whatever happens here.
 */
export default function BatterySetup() {
  const t = useT();
  const { first } = useLocalSearchParams<{ first?: string }>();
  const isFirst = first === '1';
  const setOnboarded = useSession((s) => s.setOnboarded);
  const [health, setHealth] = useState<ReminderHealth | null>(null);
  const [tried, setTried] = useState<Set<StepId>>(new Set());
  const [testSent, setTestSent] = useState(false);

  const refresh = useCallback(async () => setHealth(await getReminderHealth()), []);
  useEffect(() => {
    void refresh();
    // Coming back from a system settings page.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const mark = (id: StepId) => setTried((s) => new Set(s).add(id));

  const steps: {
    id: StepId;
    label: string;
    ok: boolean;
    action: () => Promise<void>;
    actionLabel: string;
  }[] = [
    {
      id: 'notifications',
      label: t('battery.step1'),
      ok: !!health?.notifications,
      actionLabel: t('battery.allow'),
      action: async () => void (await requestNotificationPermission()),
    },
    {
      id: 'exactAlarms',
      label: t('battery.step2'),
      ok: !!health?.exactAlarms,
      actionLabel: t('battery.open'),
      action: openAlarmSettings,
    },
    {
      id: 'batteryExempt',
      label: t('battery.step3'),
      ok: !!health?.batteryExempt,
      actionLabel: t('battery.open'),
      action: openBatterySettings,
    },
  ];

  const supported = health?.supported ?? Platform.OS === 'android';
  const allTried = steps.every((s) => s.ok || tried.has(s.id));
  const canFinish = !supported || allTried;

  const finish = async () => {
    await setOnboarded(true);
    router.replace('/');
  };

  return (
    <>
      <Header title={t('battery.title')} noBack={isFirst} />
      <Screen edges={['bottom']}>
        <Text variant="bodyLarge">{t('battery.intro')}</Text>
        {!supported ? (
          <Banner icon="information-outline" tone="mint" text={t('battery.webNote')} />
        ) : null}

        {steps.map((s, idx) => (
          <Card key={s.id} style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: s.ok ? colors.taken : colors.primaryContainer,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {s.ok ? (
                  <Icon name="check" size={26} color="onPrimary" />
                ) : (
                  <Text variant="titleMedium">{String.fromCharCode(0x09e7 + idx)}</Text>
                )}
              </View>
              <Text variant="titleMedium" style={{ flex: 1 }}>
                {s.label}
              </Text>
            </View>
            {s.ok ? (
              <Text variant="bodyMedium" style={{ color: colors.taken }}>
                ✓ {t('battery.done')}
              </Text>
            ) : (
              <Button
                label={s.actionLabel}
                variant="tonal"
                disabled={!supported}
                onPress={async () => {
                  mark(s.id);
                  await s.action();
                  await refresh();
                }}
              />
            )}
          </Card>
        ))}

        <Button
          label={t('battery.test')}
          variant="secondary"
          icon="alarm-light-outline"
          disabled={!supported}
          onPress={async () => {
            await scheduleTestAlarm();
            setTestSent(true);
          }}
        />
        {testSent ? (
          <Text variant="bodyMedium" accessibilityLiveRegion="polite">
            {t('battery.testSent')}
          </Text>
        ) : null}
        <Text variant="caption">{t('battery.smsNote')}</Text>

        <Button
          label={isFirst ? t('battery.finish') : t('common.done')}
          disabled={isFirst && !canFinish}
          onPress={isFirst ? finish : () => router.back()}
        />
      </Screen>
    </>
  );
}
