import { useFocusEffect, router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { Dose } from '@uposhom/shared';
import { AdherenceRing } from '../../src/components/AdherenceRing';
import { BottomSheet } from '../../src/components/BottomSheet';
import { Button } from '../../src/components/Button';
import { DoseCard } from '../../src/components/DoseCard';
import { FactsCarousel } from '../../src/components/FactsCarousel';
import { Banner, EmptyState, ErrorState, Loading, SectionTitle } from '../../src/components/Misc';
import { Text } from '../../src/components/Text';
import {
  canActOn,
  useActiveProfile,
  useDoseAction,
  useNow,
  useTodayDoses,
} from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/utils/errors';
import { getReminderHealth } from '../../src/notifications/reminders';
import { colors } from '../../src/theme/colors';
import { BUCKET_WORD, type Bucket } from '../../src/utils/bangla';
import { bucketOfInstant, formatDateBn } from '../../src/utils/dates';

const BUCKETS: Bucket[] = ['morning', 'noon', 'evening', 'night'];

/** Screen 1: Home dashboard, today's routine. */
export default function Home() {
  const t = useT();
  const { profile, isLoading: loadingProfile } = useActiveProfile();
  const { data, isLoading, isError, error, refetch, isRefetching } = useTodayDoses(profile?.id);
  const act = useDoseAction(profile?.id);
  const now = useNow();
  const [skipFor, setSkipFor] = useState<Dose | null>(null);
  const [batteryOk, setBatteryOk] = useState(true);

  useFocusEffect(
    useCallback(() => {
      void getReminderHealth().then((h) =>
        setBatteryOk(!h.supported || (h.notifications && h.exactAlarms && h.batteryExempt)),
      );
    }, []),
  );

  const doses = useMemo(
    () => [...(data?.doses ?? [])].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    [data],
  );
  const grouped = useMemo(
    () =>
      BUCKETS.map((b) => ({
        bucket: b,
        items: doses.filter((d) => bucketOfInstant(d.dueAt) === b),
      })).filter((g) => g.items.length > 0),
    [doses],
  );
  const canAct = canActOn(profile);

  const skipReasons = [
    t('dose.skipReasons.nausea'),
    t('dose.skipReasons.noMedicine'),
    t('dose.skipReasons.doctor'),
    t('dose.skipReasons.other'),
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          colors={[colors.primary]}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.dateRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headlineMedium" accessibilityRole="header">
            {t('home.title')}
          </Text>
          <Text variant="bodyLarge" color="onSurfaceVariant">
            {formatDateBn(now)}
          </Text>
        </View>
        <AdherenceRing percent={data?.adherenceRate} label={t('home.adherence')} />
      </View>

      {act.isError ? (
        <Banner icon="alert-circle-outline" text={errorMessage(act.error, t)} />
      ) : null}
      {data?.fromCache ? (
        <Banner icon="wifi-off" text={t('home.offlineBanner')} tone="mint" />
      ) : null}
      {!batteryOk ? (
        <Banner
          text={t('home.batteryBanner')}
          actionLabel={t('home.batteryFix')}
          onAction={() => router.push('/battery-setup')}
        />
      ) : null}

      <FactsCarousel />

      <View style={styles.quick}>
        <View style={{ flex: 1 }}>
          <Button
            label={t('home.quickSymptoms')}
            variant="tonal"
            icon="stethoscope"
            onPress={() => router.push('/symptoms')}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t('home.quickAsk')}
            variant="tonal"
            icon="microphone"
            onPress={() => router.push('/voice')}
          />
        </View>
      </View>

      {!canAct ? <Banner icon="eye-outline" text={t('home.viewerNote')} tone="mint" /> : null}

      {loadingProfile || (isLoading && !data) ? (
        <Loading label={t('common.loading')} />
      ) : isError && !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon="pill"
          title={t('home.empty')}
          actionLabel={t('home.emptyAction')}
          onAction={() => router.push('/scan')}
        />
      ) : (
        grouped.map((g) => (
          <View key={g.bucket} style={{ gap: 12 }}>
            <SectionTitle>{`${BUCKET_WORD[g.bucket]}`}</SectionTitle>
            {g.items.map((d) => (
              <DoseCard
                key={d.id}
                dose={d}
                canAct={canAct}
                overdue={d.status === 'SCHEDULED' && new Date(d.dueAt).getTime() < now}
                onTaken={() => act.mutate({ dose: d, body: { action: 'TAKEN' } })}
                onSnooze={() =>
                  act.mutate({ dose: d, body: { action: 'SNOOZE', snoozeMinutes: 15 } })
                }
                onSkip={() => setSkipFor(d)}
              />
            ))}
          </View>
        ))
      )}

      <BottomSheet visible={!!skipFor} onClose={() => setSkipFor(null)} title={t('dose.skipTitle')}>
        {skipReasons.map((reason) => (
          <Button
            key={reason}
            label={reason}
            variant="secondary"
            onPress={() => {
              if (skipFor)
                act.mutate({ dose: skipFor, body: { action: 'SKIP', skipReason: reason } });
              setSkipFor(null);
            }}
          />
        ))}
      </BottomSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quick: { flexDirection: 'row', gap: 10 },
});
