import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { Profile } from '@uposhom/shared';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Chip';
import { Icon } from '../../src/components/Icon';
import { Avatar, Banner, ErrorState, Loading } from '../../src/components/Misc';
import { Text } from '../../src/components/Text';
import { useCircle } from '../../src/hooks/queries';
import { bn, useT } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { MIN_TOUCH } from '../../src/theme/spacing';
import { formatPercentBn } from '../../src/utils/bangla';

type RelKey = keyof typeof bn.family.relationship;

/** Screen 4: Family circle and dependents. Free has the one own profile, Premium up to six more. */
export default function Family() {
  const t = useT();
  const { data, isLoading, isError, error, refetch, isRefetching } = useCircle();
  const atLimit =
    !!data &&
    data.profiles.length >= (data.circle.maxProfiles ?? (data.circle.tier === 'PREMIUM' ? 7 : 1));

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
    >
      <View style={styles.titleRow}>
        <Text variant="headlineMedium" style={{ flex: 1 }} accessibilityRole="header">
          {t('family.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('family.settings')}
          onPress={() => router.push('/settings')}
          style={styles.gear}
        >
          <Icon name="cog-outline" size={28} color="primary" />
        </Pressable>
      </View>

      {isLoading && !data ? <Loading label={t('common.loading')} /> : null}
      {isError && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}

      {data?.profiles.map((p) => (
        <ProfileCard key={p.id} profile={p} />
      ))}

      {data ? (
        atLimit && data.circle.tier === 'FREE' ? (
          <>
            <Banner icon="lock-outline" text={t('family.limit')} tone="mint" />
            <Button
              label={t('common.premiumTake')}
              icon="star-circle-outline"
              onPress={() => router.push('/premium')}
            />
          </>
        ) : (
          <Button
            label={t('family.add')}
            icon="account-plus-outline"
            variant="secondary"
            onPress={() => router.push('/add-dependent')}
          />
        )
      ) : null}
    </ScrollView>
  );
}

function ProfileCard({ profile }: { profile: Profile }) {
  const t = useT();
  const missed = profile.status === 'MISSED_CRITICAL';
  const rel = (
    profile.relationship in bn.family.relationship ? profile.relationship : 'OTHER'
  ) as RelKey;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={profile.name}
      onPress={() => router.push(`/profile/${profile.id}`)}
    >
      <Card borderColor={missed ? colors.tertiary : undefined} style={styles.card}>
        <Avatar emoji={profile.avatar} size={60} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="titleMedium" numberOfLines={1}>
            {profile.name}
          </Text>
          <Badge label={t(`family.relationship.${rel}`)} tone="primary" />
          <View style={styles.statusRow}>
            <StatusDot
              missed={missed}
              label={missed ? t('family.statusMissed') : t('family.statusOk')}
            />
            <Text variant="caption" style={{ flex: 1 }}>
              {missed ? t('family.statusMissed') : t('family.statusOk')}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text
            variant="numberLarge"
            style={{ color: (profile.adherenceRate ?? 100) >= 80 ? colors.taken : colors.tertiary }}
          >
            {profile.adherenceRate == null ? '—' : formatPercentBn(profile.adherenceRate)}
          </Text>
          <Text variant="caption">{t('family.adherence')}</Text>
        </View>
        <Icon name="chevron-right" size={26} color="onSurfaceVariant" />
      </Card>
    </Pressable>
  );
}

/** Green dot when all is well, pulsing amber dot while a missed critical dose waits for the caregiver. */
function StatusDot({ missed, label }: { missed: boolean; label: string }) {
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (missed && !reduce) scale.value = withRepeat(withTiming(1.5, { duration: 800 }), -1, true);
    else scale.value = 1;
  }, [missed, reduce, scale]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: missed ? 2 - scale.value : 1,
  }));
  return (
    <Animated.View
      accessibilityLabel={label}
      style={[styles.dot, { backgroundColor: missed ? colors.tertiary : colors.taken }, style]}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  gear: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: MIN_TOUCH * 1.5 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
