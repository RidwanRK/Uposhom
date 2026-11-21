import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ReportValue } from '@uposhom/shared';
import { api } from '../../src/api/endpoints';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Chip';
import { Header } from '../../src/components/Header';
import { Icon } from '../../src/components/Icon';
import { Disclaimer, ErrorState, Loading } from '../../src/components/Misc';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { qk } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { MIN_TOUCH } from '../../src/theme/spacing';
import { toBn } from '../../src/utils/bangla';
import { formatShortDateBn } from '../../src/utils/dates';

/** Detailed metric cards with the flag analyzer and a Bangla explainer accordion (design.md 6.5). */
export default function ReportDetail() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.report(String(id)),
    queryFn: () => api.reports.get(String(id)),
  });

  return (
    <>
      <Header title={data?.testType ?? t('report.title')} />
      <Screen edges={['bottom']}>
        {isLoading ? <Loading label={t('common.loading')} /> : null}
        {isError ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {data ? (
          <>
            <Text variant="bodyLarge">
              {data.center} · {formatShortDateBn(`${data.date}T12:00:00+06:00`)}
            </Text>
            {data.values.map((v) => (
              <Metric key={v.test} v={v} />
            ))}
            <Disclaimer text={t('report.disclaimer')} />
          </>
        ) : null}
      </Screen>
    </>
  );
}

function Metric({ v }: { v: ReportValue }) {
  const t = useT();
  const [open, setOpen] = useState(v.flag !== 'NORMAL');
  const flag =
    v.flag === 'HIGH'
      ? {
          tone: 'coral' as const,
          icon: 'arrow-up-bold' as const,
          label: `${t('report.high')} (High)`,
        }
      : v.flag === 'LOW'
        ? {
            tone: 'coral' as const,
            icon: 'arrow-down-bold' as const,
            label: `${t('report.low')} (Low)`,
          }
        : v.flag === 'NORMAL'
          ? { tone: 'green' as const, icon: 'check' as const, label: t('report.normal') }
          : { tone: 'gray' as const, icon: 'help' as const, label: t('report.unknown') };
  return (
    <Card
      style={{ gap: 10 }}
      borderColor={v.flag === 'HIGH' || v.flag === 'LOW' ? colors.tertiary : undefined}
    >
      <Text variant="titleMedium">{v.test}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text variant="numberLarge">{toBn(v.value)}</Text>
        <Text variant="bodyLarge">{v.unit}</Text>
      </View>
      <Text variant="bodyMedium">
        ({t('report.range')}: {toBn(v.printedRange)})
      </Text>
      <Badge tone={flag.tone} icon={flag.icon} label={flag.label} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={26} color="primary" />
        <Text variant="titleLarge" style={{ fontSize: 16 }}>
          {t('report.explain')}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: colors.mintTint, padding: 12, borderRadius: 12 }}>
          <Text variant="bodyLarge" color="onSurface">
            {v.explanationBn}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
