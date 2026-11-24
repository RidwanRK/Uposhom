import { useState } from 'react';
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

/** A disabled button stays readable: solid grey with dark text, never a faded colour on white. */
const DISABLED = { bg: colors.surfaceVariant, fg: colors.onSurfaceVariant, border: colors.outline };

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

/**
 * Minimum 56dp tall (design.md section 4).
 *
 * The style is a plain array, never a `style={({ pressed }) => ...}` function: with NativeWind's
 * JSX transform, Pressable is wrapped by react-native-css-interop, which can drop a style function,
 * and the button then lost its background (white label on a white screen). The pressed state is
 * tracked here instead.
 */
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
  const [pressed, setPressed] = useState(false);
  const off = !!disabled && !loading;
  const s = off ? DISABLED : STYLES[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
      style={[
        styles.base,
        {
          backgroundColor: s.bg,
          borderColor: s.border ?? 'transparent',
          borderWidth: s.border ? 2 : 0,
        },
        !fullWidth && styles.inline,
        pressed && !inactive && styles.pressed,
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
  inline: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.85 },
});
