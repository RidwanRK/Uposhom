import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api } from '../api/endpoints';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Banner, ErrorState, Loading } from '../components/Misc';
import { SubscribeOtpSheet } from '../components/SubscribeOtpSheet';
import { Text } from '../components/Text';
import { qk, useSubscription } from '../hooks/queries';
import { trList, useT } from '../i18n';
import { useSession } from '../store/session';
import { colors } from '../theme/colors';
import { MIN_TOUCH } from '../theme/spacing';
import { errorMessage } from '../utils/errors';

/**
 * Screen 11: Premium upgrade and consent (also the pharmacy plan in the Subscription tab).
 * Nothing is requested until the unticked consent box is ticked. After confirming, Premium unlocks only
 * when the server's own subscription record says ACTIVE (this screen polls), never from the tap alone.
 */
export function PremiumView() {
  const t = useT();
  const qc = useQueryClient();
  const isPharmacy = useSession((s) => s.user?.role === 'PHARMACY_OWNER');
  const [waiting, setWaiting] = useState(false);
  const { data, isLoading, isError, error, refetch } = useSubscription(waiting);
  const [agreed, setAgreed] = useState(false); // unticked by default
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [askCode, setAskCode] = useState(false);

  const status = data?.status ?? 'INACTIVE';

  // Keep polling while the carrier has not confirmed yet.
  useEffect(() => {
    setWaiting(status === 'PENDING');
    if (status === 'ACTIVE') {
      void qc.invalidateQueries({ queryKey: qk.circle });
      void qc.invalidateQueries({ queryKey: qk.entitlements });
      void qc.invalidateQueries({ queryKey: ['pharmacyMe'] });
    }
  }, [status, qc]);

  // The code was accepted by Applink: refresh the server's own record. Premium shows only when it
  // says ACTIVE (or PENDING while the carrier settles it).
  const codeAccepted = async () => {
    setAskCode(false);
    setMessage(null);
    try {
      await refetch();
    } catch (e) {
      setMessage(errorMessage(e, t));
    }
  };

  const cancel = async () => {
    setConfirmCancel(false);
    setBusy(true);
    try {
      await api.billing.unsubscribe();
      await refetch();
      setAgreed(false);
    } catch (e) {
      setMessage(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading && !data) return <Loading label={t('common.loading')} />;
  if (isError && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const perks = trList(isPharmacy ? 'premium.pharmacyPerks' : 'premium.perks');

  return (
    <View style={{ gap: 16 }}>
      <Card tone="mint" style={{ gap: 12 }}>
        {perks.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="check-circle" size={24} color="primary" />
            <Text variant="bodyLarge" color="onSurface" style={{ flex: 1 }}>
              {p}
            </Text>
          </View>
        ))}
      </Card>

      {status === 'ACTIVE' ? (
        <>
          <Banner icon="check-decagram" tone="mint" text={t('premium.active')} />
          <Button
            label={t('premium.cancel')}
            variant="secondary"
            loading={busy}
            onPress={() => setConfirmCancel(true)}
          />
          <Text variant="caption">{t('premium.stopSms')}</Text>
        </>
      ) : status === 'PENDING' ? (
        <>
          <Banner icon="timer-sand" tone="mint" text={t('premium.pending')} />
          <Loading />
        </>
      ) : (
        <>
          {status === 'CANCELLED' ? (
            <Banner icon="information-outline" tone="mint" text={t('premium.cancelled')} />
          ) : null}
          <Card style={{ gap: 12 }}>
            <Text variant="titleMedium" accessibilityRole="header">
              {t('premium.title')}
            </Text>
            <Text variant="bodyLarge" color="onSurface">
              {t('premium.consent')}
            </Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreed }}
              onPress={() => setAgreed((v) => !v)}
              style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  borderWidth: 3,
                  borderColor: colors.primary,
                  backgroundColor: agreed ? colors.primary : colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {agreed ? <Icon name="check-bold" size={24} color="onPrimary" /> : null}
              </View>
              <Text variant="titleMedium" style={{ flex: 1 }}>
                {t('premium.checkbox')}
              </Text>
            </Pressable>
          </Card>
          {message ? (
            <Text
              variant="bodyMedium"
              style={{ color: colors.emergency }}
              accessibilityLiveRegion="assertive"
            >
              {message}
            </Text>
          ) : null}
          <Button
            label={t('premium.confirm')}
            disabled={!agreed}
            loading={busy}
            onPress={() => setAskCode(true)}
          />
        </>
      )}

      {/* The consent wording shown on screen is what is stored as evidence when the code is sent. */}
      <SubscribeOtpSheet
        visible={askCode}
        consentWording={t('premium.consent')}
        onClose={() => setAskCode(false)}
        onDone={codeAccepted}
      />

      <BottomSheet
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('premium.cancel')}
      >
        <Text variant="bodyLarge">{t('premium.cancelConfirm')}</Text>
        <Button label={t('premium.cancel')} variant="danger" onPress={cancel} />
        <Button label={t('common.back')} variant="ghost" onPress={() => setConfirmCancel(false)} />
      </BottomSheet>
    </View>
  );
}
