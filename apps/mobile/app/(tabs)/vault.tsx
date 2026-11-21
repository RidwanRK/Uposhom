import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { api } from '../../src/api/endpoints';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Chip';
import { HistoryView } from '../../src/components/HistoryView';
import { Icon } from '../../src/components/Icon';
import { EmptyState, ErrorState, Loading, SectionTitle } from '../../src/components/Misc';
import { Segmented } from '../../src/components/Segmented';
import { Text } from '../../src/components/Text';
import { qk, useActiveProfile, useTodayDoses } from '../../src/hooks/queries';
import { usePaymentGate } from '../../src/hooks/usePaymentGate';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { formatShortDateBn } from '../../src/utils/dates';
import { prepareImage } from '../../src/utils/image';

type Seg = 'rx' | 'reports' | 'history';

/** Screen 5: Health Vault. Prescription vault, lab report vault, and history (Screen 8) as segments. */
export default function Vault() {
  const t = useT();
  const [seg, setSeg] = useState<Seg>('rx');
  const { profile } = useActiveProfile();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text variant="headlineMedium" accessibilityRole="header">
        {t('vault.title')}
      </Text>
      <View style={styles.quick}>
        <View style={{ flex: 1 }}>
          <Button label={t('vault.addScan')} icon="plus" onPress={() => router.push('/scan')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t('vault.symptoms')}
            icon="stethoscope"
            variant="tonal"
            onPress={() => router.push('/symptoms')}
          />
        </View>
      </View>
      <Segmented<Seg>
        value={seg}
        onChange={setSeg}
        options={[
          { value: 'rx', label: t('vault.segPrescriptions') },
          { value: 'reports', label: t('vault.segReports') },
          { value: 'history', label: t('vault.segHistory') },
        ]}
      />
      {seg === 'rx' ? <RxList profileId={profile?.id} /> : null}
      {seg === 'reports' ? <ReportList profileId={profile?.id} /> : null}
      {seg === 'history' ? <HistoryView profileId={profile?.id} /> : null}
    </ScrollView>
  );
}

/** Current medicines, as the server's schedule lists them. (No prescription-list endpoint exists yet.) */
function RxList({ profileId }: { profileId: string | undefined }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useTodayDoses(profileId);
  const meds = useMemo(() => {
    const m = new Map<string, { name: string; sub: string; critical: boolean }>();
    for (const d of data?.doses ?? []) {
      if (!m.has(d.medicine))
        m.set(d.medicine, {
          name: d.medicineBn ?? d.medicine,
          sub: d.medicine,
          critical: !!d.isCritical,
        });
    }
    return [...m.values()];
  }, [data]);

  if (isLoading && !data) return <Loading label={t('common.loading')} />;
  if (isError && !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (meds.length === 0)
    return (
      <EmptyState
        icon="file-document-outline"
        title={t('vault.emptyRx')}
        actionLabel={t('vault.addScan')}
        onAction={() => router.push('/scan')}
      />
    );
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle>{t('vault.todaysMedicines')}</SectionTitle>
      {meds.map((m) => (
        <Card key={m.sub} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.medIcon}>
            <Icon name="pill" size={26} color="primary" />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium">{m.name}</Text>
            {m.name !== m.sub ? <Text variant="caption">{m.sub}</Text> : null}
          </View>
          {m.critical ? <Badge tone="amber" icon="alert-circle" label="Critical" /> : null}
        </Card>
      ))}
    </View>
  );
}

function ReportList({ profileId }: { profileId: string | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const gate = usePaymentGate();
  const [busy, setBusy] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...qk.reports, profileId],
    queryFn: () => api.reports.list(profileId),
  });

  const addReport = async () => {
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (pick.canceled || !pick.assets[0]) return;
    const a = pick.assets[0];
    setBusy(true);
    try {
      const file = await prepareImage(a.uri, a.width, a.height);
      const upload = () => api.reports.uploadAndParse(file, profileId);
      let report;
      try {
        report = await upload();
      } catch (e) {
        if (gate.paymentPurpose(e) && (await gate.requestPayment('REPORT_EXPLAIN')))
          report = await upload();
        else throw e;
      }
      await qc.invalidateQueries({ queryKey: qk.reports });
      router.push(`/report/${report.id}`);
    } catch {
      // The list stays as it was; the person can try again.
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading label={t('common.loading')} />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <View style={{ gap: 12 }}>
      <Button
        label={t('vault.addReport')}
        icon="file-plus-outline"
        variant="secondary"
        loading={busy}
        onPress={addReport}
      />
      {data.reports.length === 0 ? (
        <EmptyState icon="flask-outline" title={t('vault.emptyReports')} />
      ) : null}
      {data.reports.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          onPress={() => router.push(`/report/${r.id}`)}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={styles.medIcon}>
              <Icon name="flask-outline" size={26} color="primary" />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="titleMedium">{r.testType}</Text>
              <Text variant="bodyMedium">{r.center}</Text>
              <Text variant="caption">{formatShortDateBn(`${r.date}T12:00:00+06:00`)}</Text>
            </View>
            <Icon name="chevron-right" size={26} color="onSurfaceVariant" />
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  quick: { flexDirection: 'row', gap: 10 },
  medIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
