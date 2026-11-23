import { useQueryClient } from '@tanstack/react-query';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { useState } from 'react';
import type { AlertItem } from '@uposhom/shared';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Badge } from '../src/components/Chip';
import { Header } from '../src/components/Header';
import { Icon, type IconName } from '../src/components/Icon';
import { Banner, EmptyState, ErrorState, Loading } from '../src/components/Misc';
import { Text } from '../src/components/Text';
import { qk, useAlerts } from '../src/hooks/queries';
import { useT } from '../src/i18n';
import { colors } from '../src/theme/colors';
import { durationBn, formatTimeBn, relativeAgoBn } from '../src/utils/dates';
import { errorMessage } from '../src/utils/errors';

const ICONS: Record<AlertItem['type'], IconName> = {
  MISSED_DOSE: 'alert-circle',
  REFILL_DUE: 'package-variant',
  FOLLOW_UP: 'calendar-clock',
  WEEKLY_DIGEST: 'chart-line',
  SMS_FAILURE: 'message-alert-outline',
};

/**
 * Screen 13: alerts inbox and caregiver acknowledge. Newest first, for every profile the user can see.
 * Acknowledging a missed-dose alert stops the secondary-caregiver alert. Acknowledged cards turn gray
 * and stay in the list.
 */
export default function Alerts() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch, isRefetching } = useAlerts();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const acknowledge = async (a: AlertItem) => {
    if (!a.doseId) return;
    setBusyId(a.id);
    setMessage(null);
    try {
      await api.doses.acknowledge(a.doseId);
      await qc.invalidateQueries({ queryKey: qk.alerts });
    } catch (e) {
      setMessage(errorMessage(e, t));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <Header title={t('alerts.title')} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            colors={[colors.primary]}
          />
        }
      >
        {message ? <Banner icon="alert-circle-outline" text={message} /> : null}
        {isLoading ? <Loading label={t('common.loading')} /> : null}
        {isError && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {data && data.alerts.length === 0 ? (
          <EmptyState icon="bell-check-outline" title={t('alerts.empty')} />
        ) : null}

        {data?.alerts.map((a) => {
          const done = a.acknowledged;
          const missed = a.type === 'MISSED_DOSE';
          return (
            <Card
              key={a.id}
              tone={done ? 'surface' : missed ? 'amber' : 'surface'}
              borderColor={!done && missed ? colors.tertiary : undefined}
              style={[
                { gap: 10 },
                done ? { opacity: 0.6, backgroundColor: colors.surfaceVariant } : null,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon
                  name={ICONS[a.type]}
                  size={28}
                  color={done ? 'skip' : missed ? 'tertiary' : 'primary'}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="titleMedium">{a.title}</Text>
                  <Text variant="caption">
                    {a.profileName} · {relativeAgoBn(a.createdAt)}
                  </Text>
                </View>
              </View>

              {a.type === 'MISSED_DOSE' && a.medicine ? (
                <View style={{ gap: 2 }}>
                  <Text variant="bodyLarge">{a.medicine}</Text>
                  {a.dueAt ? (
                    <Text variant="bodyMedium">
                      {t('alerts.due')}: {formatTimeBn(a.dueAt)}
                      {a.overdueMinutes != null ? ` · ${durationBn(a.overdueMinutes)} দেরি` : ''}
                    </Text>
                  ) : null}
                </View>
              ) : a.body ? (
                <Text variant="bodyLarge" color="onSurface">
                  {a.body}
                </Text>
              ) : null}

              {done ? (
                <Badge
                  tone="gray"
                  icon="check"
                  label={`${t('alerts.acknowledged')}${a.acknowledgedAt ? ` · ${formatTimeBn(a.acknowledgedAt)}` : ''}`}
                />
              ) : missed && a.doseId ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t('alerts.acknowledge')}
                      icon="eye-check-outline"
                      loading={busyId === a.id}
                      onPress={() => acknowledge(a)}
                    />
                  </View>
                  {a.callPhone ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label={t('common.call')}
                        icon="phone"
                        variant="secondary"
                        onPress={() => void Linking.openURL(`tel:${a.callPhone}`)}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </>
  );
}
