import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

/** Tappable filter / choice chip. 56dp tall like every other touch target. */
export function Chip({ label, selected, onPress, icon, style }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primaryContainer : colors.surface,
          borderColor: selected ? colors.primary : colors.outline,
        },
        style,
      ]}
    >
      {icon ? (
        <Icon name={icon} size={20} color={selected ? 'onPrimaryContainer' : 'onSurfaceVariant'} />
      ) : null}
      <Text
        variant="bodyLarge"
        style={{
          color: selected ? colors.onPrimaryContainer : colors.onSurface,
          fontWeight: selected ? '700' : '400',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type Tone = 'primary' | 'amber' | 'green' | 'gray' | 'red' | 'coral';
const TONES: Record<Tone, { bg: string; fg: string }> = {
  primary: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer },
  amber: { bg: colors.tertiary, fg: colors.onTertiary },
  green: { bg: colors.taken, fg: colors.onPrimary },
  gray: { bg: colors.skip, fg: colors.onPrimary },
  red: { bg: colors.emergency, fg: colors.onError },
  coral: { bg: colors.tertiary, fg: colors.onTertiary },
};

/** Non-interactive status badge (no 56dp requirement: it is a label, not a control). */
export function Badge({
  label,
  tone = 'primary',
  icon,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={16} color={t.fg} /> : null}
      <Text variant="caption" style={{ color: t.fg, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
});
