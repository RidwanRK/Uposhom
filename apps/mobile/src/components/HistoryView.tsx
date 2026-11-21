import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { View } from 'react-native';
import type { PatternCard, TimelineEntry } from '@uposhom/shared';
import { api } from '../api/endpoints';
import { qk } from '../hooks/queries';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { toBn } from '../utils/bangla';
import { formatMonthKeyBn, formatShortDateBn } from '../utils/dates';
import { Button } from './Button';
import { Card } from './Card';
import { Badge } from './Chip';
import { Icon } from './Icon';
import { Banner, Disclaimer, EmptyState, ErrorState, Loading, SectionTitle } from './Misc';
import { Text } from './Text';

/**
 * Sickness History and Insights (design.md Screen 8): month-by-month timeline for everyone, pattern
 * cards for Premium only. Pattern cards appear only when the minimum record count is met. Never a
 * diagnosis, never a dose.
 */
export function HistoryView({ profileId }: { profileId: string | undefined }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.insights(profileId),
    enabled: !!profileId,
    queryFn: () => api.insights.get(profileId!),
  });

  if (isLoading) return <Loading label={t('common.loading')} />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const months = new Map<string, TimelineEntry[]>();
  for (const e of data.timeline) {
    const key = e.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), e]);
  }

  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 12 }}>
        <SectionTitle>{t('insights.patterns')}</SectionTitle>
        {data.patternsLocked ? (
          <Card tone="mint" style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name="lock-outline" size={26} color="primary" />
              <Text variant="bodyLarge" color="onSurface" style={{ flex: 1 }}>
                {t('insights.locked')}
              </Text>
            </View>
            <Button
              label={t('common.premiumTake')}
              icon="star-circle-outline"
              onPress={() => router.push('/premium')}
            />
          </Card>
        ) : data.patterns.length === 0 ? (
          <Banner icon="chart-bar" tone="mint" text={t('insights.needMore')} />
        ) : (
          data.patterns.map((p) => <PatternCardView key={p.id} card={p} />)
        )}
      </View>

      <View style={{ gap: 12 }}>
        <SectionTitle>{t('insights.timeline')}</SectionTitle>
        {data.timeline.length === 0 ? (
          <EmptyState icon="history" title={t('insights.emptyTimeline')} />
        ) : (
          [...months.entries()].map(([key, entries]) => (
            <View key={key} style={{ gap: 8 }}>
              <Text variant="titleMedium" color="secondary">
                {formatMonthKeyBn(key)}
              </Text>
              {entries.map((e) => (
                <Card key={e.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: colors.primaryContainer,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon
                      name={e.kind === 'SYMPTOM' ? 'stethoscope' : 'pill'}
                      size={24}
                      color="primary"
                    />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="titleMedium">{e.title}</Text>
                    <Text variant="caption">
                      {formatShortDateBn(`${e.date}T12:00:00+06:00`)} ·{' '}
                      {e.kind === 'SYMPTOM' ? t('insights.kindSymptom') : t('insights.kindRx')}
                    </Text>
                    {e.therapeuticClass ? (
                      <Badge label={e.therapeuticClass} tone="primary" />
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          ))
        )}
      </View>

      <Disclaimer text={t('insights.disclaimer')} />
    </View>
  );
}

/** Small bar chart of counts by month plus one plain-Bangla sentence and a lifestyle tip. */
function PatternCardView({ card }: { card: PatternCard }) {
  const t = useT();
  const max = Math.max(1, ...card.monthly.map((m) => m.count));
  return (
    <Card style={{ gap: 14 }}>
      <Text variant="titleMedium">{card.sentenceBn}</Text>
      <View
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 110 }}
        accessibilityLabel={card.sentenceBn}
      >
        {card.monthly.map((m) => (
          <View
            key={m.month}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'flex-end',
              height: '100%',
              gap: 4,
            }}
          >
            <Text variant="caption" style={{ fontSize: 12 }}>
              {toBn(m.count)}
            </Text>
            <View
              style={{
                width: '70%',
                height: Math.max(6, (m.count / max) * 64),
                backgroundColor: colors.primary,
                borderRadius: 6,
              }}
            />
            <Text variant="caption" style={{ fontSize: 11, lineHeight: 15 }} numberOfLines={1}>
              {formatMonthKeyBn(m.month).split(' ')[0]}
            </Text>
          </View>
        ))}
      </View>
      <View
        style={{
          backgroundColor: colors.mintTint,
          borderRadius: 12,
          padding: 12,
          flexDirection: 'row',
          gap: 8,
        }}
      >
        <Icon name="lightbulb-on-outline" size={22} color="primary" />
        <Text variant="bodyMedium" color="onSurface" style={{ flex: 1 }}>
          {t('insights.tip')}: {card.tipBn}
        </Text>
      </View>
    </Card>
  );
}
