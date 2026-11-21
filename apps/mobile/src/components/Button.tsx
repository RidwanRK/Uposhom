import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'tonal' | 'danger' | 'success' | 'ghost' | 'onDark';

const STYLES: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary },
  secondary: { bg: colors.surface, fg: colors.primary, border: colors.primary },
  tonal: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer },
  danger: { bg: colors.emergency, fg: colors.onError },
  success: { bg: colors.taken, fg: colors.onPrimary },
  ghost: { bg: 'transparent', fg: colors.primary },
  onDark: { bg: colors.surface, fg: colors.emergency },
};

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the parent's width (default). */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/** Minimum 56dp tall (design.md section 4). */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  fullWidth = true,
  style,
  accessibilityHint,
}: Props) {
  const s = STYLES[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: s.bg,
          borderColor: s.border ?? 'transparent',
          borderWidth: s.border ? 2 : 0,
        },
        !fullWidth && { alignSelf: 'flex-start' },
        inactive && styles.disabled,
        pressed && { opacity: 0.88 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={s.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={22} color={s.fg} /> : null}
          <Text variant="labelLarge" style={{ color: s.fg, flexShrink: 1, textAlign: 'center' }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  disabled: { opacity: 0.45 },
});
