import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, View } from 'react-native';
import { api } from '../../src/api/endpoints';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Chip';
import { Header } from '../../src/components/Header';
import { Icon } from '../../src/components/Icon';
import { Banner, EmptyState, ErrorState, Loading } from '../../src/components/Misc';
import { Text } from '../../src/components/Text';
import { qk } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { colors } from '../../src/theme/colors';
import { toBn } from '../../src/utils/bangla';
import { formatDateBn, formatTimeBn } from '../../src/utils/dates';

/**
 * Admin-only agent-trace viewer (Master Plan 18 D7): which agent ran, its handoffs, tool calls and
 * latency. Reached only from the Developer row in Settings, shown to admin accounts. The server checks
 * the admin flag again on every read, so the app is not the only guard.
 */
export default function Traces() {
  const t = useT();
  const isAdmin = useSession((s) => !!s.user?.isAdmin);
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: qk.traces,
    enabled: isAdmin,
    queryFn: () => api.admin.traces(),
  });

  if (!isAdmin) {
    return (
      <>
        <Header title={t('admin.title')} />
        <Banner icon="lock-outline" text={t('admin.denied')} />
      </>
    );
  }

  return (
    <>
      <Header title={t('admin.title')} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            colors={[colors.primary]}
          />
        }
      >
        {isLoading ? <Loading label={t('common.loading')} /> : null}
        {isError && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {data && data.traces.length === 0 ? (
          <EmptyState icon="graph-outline" title={t('admin.empty')} />
        ) : null}
        {data?.traces.map((tr) => (
          <Card key={tr.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="robot-outline" size={24} color="primary" />
              <Text variant="titleMedium" style={{ flex: 1 }}>
                {tr.agent}
              </Text>
              <Badge tone="primary" icon="timer-outline" label={`${toBn(tr.latencyMs)} ms`} />
            </View>
            <Text variant="caption">
              {formatDateBn(tr.createdAt)} · {formatTimeBn(tr.createdAt)}
            </Text>
            {tr.inputPreview ? (
              <Text variant="bodyMedium" color="onSurface">
                “{tr.inputPreview}”
              </Text>
            ) : null}
            <View style={{ gap: 2 }}>
              <Text variant="caption">{t('admin.handoffs')}</Text>
              {tr.handoffs.length === 0 ? (
                <Text variant="bodyMedium">{t('admin.noHandoff')}</Text>
              ) : (
                tr.handoffs.map((h, i) => (
                  <Text key={i} variant="bodyMedium" color="onSurface">
                    {h.from} → {h.to}
                  </Text>
                ))
              )}
            </View>
            {tr.toolCalls.length > 0 ? (
              <View style={{ gap: 2 }}>
                <Text variant="caption">{t('admin.tools')}</Text>
                {tr.toolCalls.map((c, i) => (
                  <Text key={i} variant="bodyMedium" color="onSurface">
                    {c.name} · {toBn(c.durationMs)} ms
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>
        ))}
      </ScrollView>
    </>
  );
}
