import { ABS } from '../theme/spacing';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import type { Dose } from '@uposhom/shared';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { MIN_TOUCH, elevation, radius } from '../theme/spacing';
import { formAndStrengthBn } from '../utils/drug';
import { formatTimeBn } from '../utils/dates';
import { Button } from './Button';
import { Badge } from './Chip';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  dose: Dose;
  /** Viewers can look but not act (profile role). */
  canAct: boolean;
  overdue: boolean;
  onTaken: () => void;
  onSnooze: () => void;
  onSkip: () => void;
}

const DONE = new Set<Dose['status']>(['TAKEN', 'TAKEN_LATE', 'SKIPPED', 'MISSED']);

export function DoseCard({ dose, canAct, overdue, onTaken, onSnooze, onSkip }: Props) {
  const t = useT();
  const done = DONE.has(dose.status);
  const swipeEnabled = canAct && !done;

  const tx = useSharedValue(0);
  const width = useSharedValue(1);
  const shake = useSharedValue(0);
  const shook = useRef(false);

  // Missed Dose Warning: gentle 2-cycle shake (+/-8dp over 300ms) and a double pulse (design.md section 7).
  useEffect(() => {
    if (!overdue || shook.current) return;
    shook.current = true;
    void (async () => {
      const reduce = await AccessibilityInfo.isReduceMotionEnabled();
      if (!reduce)
        shake.value = withSequence(
          withRepeat(withTiming(8, { duration: 37 }), 8, true),
          withTiming(0, { duration: 20 }),
        );
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setTimeout(
          () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
          180,
        );
      } catch {
        // haptics are best effort
      }
    })();
  }, [overdue, shake]);

  const confirm = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onTaken();
    tx.value = withTiming(0, { duration: 250 });
  };

  const pan = usePanGesture({
    enabled: swipeEnabled,
    activeOffsetX: 14,
    failOffsetY: [-14, 14],
    onUpdate: (e) => {
      'worklet';
      tx.value = Math.max(0, e.translationX);
    },
    onDeactivate: () => {
      'worklet';
      if (tx.value > width.value * 0.5) {
        tx.value = withTiming(width.value, { duration: 140 }, (finished) => {
          if (finished) scheduleOnRN(confirm);
        });
      } else {
        tx.value = withSpring(0, { damping: 14, stiffness: 150 });
      }
    },
  });

  const fg = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value + shake.value }] }));
  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      tx.value,
      [0, width.value * 0.5],
      [colors.surface, colors.taken],
    ),
    opacity: interpolate(tx.value, [0, 12], [0, 1], Extrapolation.CLAMP),
  }));

  const name = dose.medicineBn ?? dose.medicine;
  const mealLabel =
    dose.mealRelation === 'AC'
      ? t('dose.mealAC')
      : dose.mealRelation === 'PC'
        ? t('dose.mealPC')
        : dose.mealRelation === 'WITH_MEAL'
          ? t('dose.mealWith')
          : dose.instructions;
  const badge = formAndStrengthBn(dose.form, dose.strength ?? dose.medicine.replace(/^[^\d]*/, ''));
  const borderColor = overdue
    ? colors.tertiary
    : dose.status === 'TAKEN' || dose.status === 'TAKEN_LATE'
      ? colors.taken
      : colors.surfaceVariant;

  return (
    <View style={{ gap: 8 }}>
      <View
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
        }}
        accessible
        accessibilityLabel={`${formatTimeBn(dose.dueAt)}, ${name}`}
        accessibilityActions={
          swipeEnabled ? [{ name: 'activate', label: t('dose.swipeToTake') }] : undefined
        }
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'activate') confirm();
        }}
      >
        <Animated.View style={[styles.revealed, bg]}>
          <Icon name="check-bold" size={36} color="onPrimary" />
          <Text variant="titleMedium" style={{ color: colors.onPrimary }}>
            {t('dose.swipeToTake')}
          </Text>
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.card, { borderColor }, fg]}>
            <View style={styles.topRow}>
              <View style={styles.time}>
                <Icon name="clock-outline" size={18} color="onPrimaryContainer" />
                <Text variant="titleMedium" style={{ color: colors.onPrimaryContainer }}>
                  {formatTimeBn(dose.dueAt)}
                </Text>
              </View>
              <StatusPill dose={dose} overdue={overdue} />
            </View>

            <Text variant="headlineSmall">{name}</Text>
            {dose.medicineBn ? <Text variant="bodyMedium">({dose.medicine})</Text> : null}
            {badge ? <Text variant="bodyMedium">{badge}</Text> : null}

            <View style={styles.chips}>
              {mealLabel ? (
                <View style={styles.mealChip}>
                  <Text variant="bodyMedium" style={{ color: colors.onPrimaryContainer }}>
                    {mealLabel}
                  </Text>
                </View>
              ) : null}
              {dose.isCritical ? (
                <Badge
                  tone="amber"
                  icon="alert-circle"
                  label={`${t('dose.critical')} (Critical)`}
                />
              ) : null}
            </View>

            {swipeEnabled ? (
              <View style={styles.hint}>
                <Icon name="arrow-right-bold-outline" size={18} color="onSurfaceVariant" />
                <Text variant="caption">{t('home.swipeHint')}</Text>
              </View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </View>

      {swipeEnabled ? (
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button
              label={t('dose.snooze')}
              variant="secondary"
              icon="alarm-snooze"
              onPress={onSnooze}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t('dose.skip')}
              variant="ghost"
              icon="skip-next-circle-outline"
              onPress={onSkip}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StatusPill({ dose, overdue }: { dose: Dose; overdue: boolean }) {
  const t = useT();
  switch (dose.status) {
    case 'TAKEN':
      return <Badge tone="green" icon="check-circle" label={t('dose.taken')} />;
    case 'TAKEN_LATE':
      return <Badge tone="green" icon="check-circle" label={t('dose.takenLate')} />;
    case 'SKIPPED':
      return <Badge tone="gray" icon="skip-next" label={t('dose.skipped')} />;
    case 'MISSED':
      return <Badge tone="amber" icon="alert" label={t('dose.missed')} />;
    case 'SNOOZED':
      return <Badge tone="amber" icon="alarm-snooze" label={t('dose.snoozed')} />;
    default:
      return overdue ? <Badge tone="amber" icon="alert" label={t('home.overdue')} /> : null;
  }
}

const styles = StyleSheet.create({
  revealed: {
    ...ABS,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: 16,
    gap: 6,
    minHeight: MIN_TOUCH * 2,
    ...elevation.card,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 },
  mealChip: {
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8 },
});
