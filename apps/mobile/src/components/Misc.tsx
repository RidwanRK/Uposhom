import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { ApiError } from '../api/client';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Amber info banner (battery setup nudge, offline notice). */
export function Banner({
  icon = 'alert-outline',
  text,
  actionLabel,
  onAction,
  tone = 'amber',
}: {
  icon?: IconName;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'amber' | 'mint';
}) {
  const amber = tone === 'amber';
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: amber ? '#FFF1E6' : colors.mintTint,
          borderColor: amber ? colors.tertiary : colors.primary,
        },
      ]}
    >
      <Icon name={icon} size={22} color={amber ? 'tertiary' : 'primary'} />
      <Text variant="bodyMedium" color="onSurface" style={{ flex: 1 }}>
        {text}
      </Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} style={styles.bannerBtn} accessibilityRole="button">
          <Text variant="labelLarge" style={{ color: amber ? colors.tertiary : colors.primary }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Disclaimer({ text }: { text: string }) {
  return (
    <View style={styles.disclaimer}>
      <Icon name="information-outline" size={18} color="onSurfaceVariant" />
      <Text variant="caption" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

export function EmptyState({
  icon = 'pill',
  title,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={40} color="primary" />
      </View>
      <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} fullWidth={false} />
      ) : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.empty} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? <Text variant="bodyMedium">{label}</Text> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  const t = useT();
  const offline = error instanceof ApiError && error.isNetwork;
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: '#FFF1E6' }]}>
        <Icon name={offline ? 'wifi-off' : 'alert-circle-outline'} size={40} color="tertiary" />
      </View>
      <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
        {offline ? t('common.noConnection') : t('common.errorGeneric')}
      </Text>
      {onRetry ? (
        <Button label={t('common.retry')} variant="secondary" onPress={onRetry} fullWidth={false} />
      ) : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text variant="titleLarge" accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

/** Number stepper (duration). Both buttons are 56dp. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 365,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="কমান"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.stepBtn, value <= min && { opacity: 0.35 }]}
      >
        <Icon name="minus" size={26} color="primary" />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text variant="titleMedium">{label}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="বাড়ান"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.stepBtn, value >= max && { opacity: 0.35 }]}
      >
        <Icon name="plus" size={26} color="primary" />
      </Pressable>
    </View>
  );
}

export function Avatar({ emoji, size = 52 }: { emoji?: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.primaryContainer,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="headlineSmall" style={{ fontSize: size * 0.5, lineHeight: size * 0.7 }}>
        {emoji ?? '🙂'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  bannerBtn: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  disclaimer: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    alignItems: 'flex-start',
  },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.outline,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  stepBtn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
