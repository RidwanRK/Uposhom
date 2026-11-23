import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../src/api/endpoints';
import { BottomSheet } from '../src/components/BottomSheet';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Header } from '../src/components/Header';
import { Icon, type IconName } from '../src/components/Icon';
import { Banner, SectionTitle } from '../src/components/Misc';
import { Screen } from '../src/components/Screen';
import { StepUpSheet } from '../src/components/StepUpSheet';
import { Switch56 } from '../src/components/Switch56';
import { Text } from '../src/components/Text';
import { cache } from '../src/db/cache';
import { qk, useEntitlements, useSubscription } from '../src/hooks/queries';
import { useT } from '../src/i18n';
import { getReminderHealth, type ReminderHealth } from '../src/notifications/reminders';
import { useSession } from '../src/store/session';
import { useSettings } from '../src/store/settings';
import { colors } from '../src/theme/colors';
import { MIN_TOUCH } from '../src/theme/spacing';
import { toBn } from '../src/utils/bangla';
import { errorMessage } from '../src/utils/errors';

/** Screen 15: Settings. Reminders, discreet SMS, text size, subscription, privacy, help, sign out. */
export default function Settings() {
  const t = useT();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const clear = useSession((s) => s.clear);
  const largeText = useSettings((s) => s.largeText);
  const setLargeText = useSettings((s) => s.setLargeText);
  const [health, setHealth] = useState<ReminderHealth | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'signOut' | 'stopSms' | 'delete' | null>(null);
  const [stepUp, setStepUp] = useState(false);

  const entitlements = useEntitlements();
  const subscription = useSubscription();
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => api.account.getSettings() });
  const update = useMutation({
    mutationFn: (b: Partial<{ discreetSms: boolean; smsReminders: boolean }>) =>
      api.account.putSettings(b),
    onSuccess: (data) => qc.setQueryData(qk.settings, data),
    onError: (e) => setMessage(errorMessage(e, t)),
  });

  useFocusEffect(
    useCallback(() => {
      void getReminderHealth().then(setHealth);
    }, []),
  );

  const premium = entitlements.data?.tier === 'PREMIUM' || subscription.data?.status === 'ACTIVE';

  const endSession = async () => {
    await cache.clear();
    await clear();
    router.replace('/(auth)/account-type');
  };

  const signOut = async () => {
    try {
      await api.auth.logout(useSession.getState().refreshToken);
    } catch {
      // sign out on this phone even if the server cannot be reached
    }
    await endSession();
  };

  const stopSms = async () => {
    setConfirm(null);
    setMessage(null);
    try {
      await api.account.optOut('SMS');
      setMessage(t('settings.stopSmsDone'));
      void qc.invalidateQueries({ queryKey: qk.subscription });
      void qc.invalidateQueries({ queryKey: qk.entitlements });
    } catch (e) {
      setMessage(errorMessage(e, t));
    }
  };

  const deleteAll = async (token: string) => {
    setStepUp(false);
    try {
      await api.account.deleteAll(token);
      await endSession();
    } catch (e) {
      setMessage(errorMessage(e, t));
    }
  };

  const notifOk = !!health && !health.supported ? null : health?.notifications;

  return (
    <>
      <Header title={t('settings.title')} />
      <Screen edges={['bottom']}>
        {message ? <Banner icon="information-outline" tone="mint" text={message} /> : null}

        <SectionTitle>{t('settings.reminders')}</SectionTitle>
        <Card style={{ gap: 6 }}>
          <Row
            icon="bell-outline"
            label={t('settings.notifications')}
            value={notifOk == null ? '—' : notifOk ? t('settings.granted') : t('settings.denied')}
            ok={!!notifOk}
          />
          <Button
            label={t('settings.fixBattery')}
            variant="secondary"
            icon="battery-heart-outline"
            onPress={() => router.push('/battery-setup')}
          />
          <Switch56
            value={settings.data?.smsReminders ?? true}
            onValueChange={(v) => update.mutate({ smsReminders: v })}
            label={t('settings.sms')}
            disabled={!settings.data}
          />
          <Switch56
            value={settings.data?.discreetSms ?? false}
            onValueChange={(v) => update.mutate({ discreetSms: v })}
            label={t('settings.discreet')}
            hint={t('settings.discreetHint')}
            disabled={!settings.data}
          />
        </Card>

        <SectionTitle>{t('settings.language')}</SectionTitle>
        <Card style={{ gap: 6 }}>
          <Row icon="translate" label={t('settings.language')} value={t('settings.langValue')} ok />
          <Switch56
            value={largeText}
            onValueChange={setLargeText}
            label={t('settings.largeText')}
          />
        </Card>

        <SectionTitle>{t('settings.subscription')}</SectionTitle>
        <Card style={{ gap: 10 }}>
          <Row
            icon="star-circle-outline"
            label={t('settings.plan')}
            value={premium ? t('settings.planPremium') : t('settings.planFree')}
            ok={premium}
          />
          <Button
            label={premium ? t('premium.cancel') : t('common.premiumTake')}
            variant={premium ? 'secondary' : 'primary'}
            onPress={() =>
              router.push(user?.role === 'PHARMACY_OWNER' ? '/(pharmacy)/subscription' : '/premium')
            }
          />
          {entitlements.data ? (
            <View style={{ gap: 2 }}>
              <Text variant="titleMedium">{t('settings.usage')}</Text>
              <Text variant="bodyMedium">
                {t('settings.scans')}: {toBn(entitlements.data.scans.used)} /{' '}
                {toBn(entitlements.data.scans.limit)}
              </Text>
              <Text variant="bodyMedium">
                {t('settings.smsUsed')}: {toBn(entitlements.data.sms.used)} /{' '}
                {toBn(entitlements.data.sms.limit)}
              </Text>
            </View>
          ) : null}
        </Card>

        <SectionTitle>{t('settings.privacy')}</SectionTitle>
        <Card style={{ gap: 10 }}>
          <Button
            label={t('settings.stopSms')}
            variant="secondary"
            icon="message-off-outline"
            onPress={() => setConfirm('stopSms')}
          />
          <Button
            label={t('settings.deleteAll')}
            variant="danger"
            icon="delete-forever-outline"
            onPress={() => setConfirm('delete')}
          />
        </Card>

        <SectionTitle>{t('settings.help')}</SectionTitle>
        <Card style={{ gap: 2 }}>
          <LinkRow
            icon="lifebuoy"
            label={t('settings.support')}
            onPress={() => router.push('/legal/support')}
          />
          <LinkRow
            icon="file-document-outline"
            label={t('settings.terms')}
            onPress={() => router.push('/legal/terms')}
          />
          <LinkRow
            icon="shield-lock-outline"
            label={t('settings.privacyPolicy')}
            onPress={() => router.push('/legal/privacy')}
          />
          {user?.isAdmin ? (
            <LinkRow
              icon="console"
              label={t('settings.developer')}
              onPress={() => router.push('/admin/traces')}
            />
          ) : null}
        </Card>

        <Button
          label={t('settings.signOut')}
          variant="danger"
          icon="logout"
          onPress={() => setConfirm('signOut')}
        />
      </Screen>

      <BottomSheet
        visible={confirm === 'signOut'}
        onClose={() => setConfirm(null)}
        title={t('settings.signOut')}
      >
        <Text variant="bodyLarge">{t('settings.signOutConfirm')}</Text>
        <Button label={t('settings.signOut')} variant="danger" onPress={signOut} />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirm(null)} />
      </BottomSheet>

      <BottomSheet
        visible={confirm === 'stopSms'}
        onClose={() => setConfirm(null)}
        title={t('settings.stopSms')}
      >
        <Text variant="bodyLarge">{t('settings.stopSmsConfirm')}</Text>
        <Button label={t('settings.stopSms')} variant="danger" onPress={stopSms} />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirm(null)} />
      </BottomSheet>

      <BottomSheet
        visible={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={t('settings.deleteAll')}
      >
        <Text variant="bodyLarge">{t('settings.deleteBody')}</Text>
        <Button
          label={t('settings.deleteAll')}
          variant="danger"
          onPress={() => {
            setConfirm(null);
            setStepUp(true);
          }}
        />
        <Button label={t('common.cancel')} variant="ghost" onPress={() => setConfirm(null)} />
      </BottomSheet>

      {/* Deleting everything needs a fresh code to the signed-in number first. */}
      <StepUpSheet visible={stepUp} onClose={() => setStepUp(false)} onToken={deleteAll} />
    </>
  );
}

function Row({
  icon,
  label,
  value,
  ok,
}: {
  icon: IconName;
  label: string;
  value: string;
  ok?: boolean;
}) {
  return (
    <View style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Icon name={icon} size={24} color="primary" />
      <Text variant="titleMedium" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="titleMedium" style={{ color: ok ? colors.taken : colors.tertiary }}>
        {value}
      </Text>
    </View>
  );
}

function LinkRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 10 }}
    >
      <Icon name={icon} size={24} color="primary" />
      <Text variant="titleMedium" style={{ flex: 1 }}>
        {label}
      </Text>
      <Icon name="chevron-right" size={24} color="onSurfaceVariant" />
    </Pressable>
  );
}
