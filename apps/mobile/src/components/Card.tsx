import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';
import { elevation, radius } from '../theme/spacing';

interface Props extends ViewProps {
  tone?: 'surface' | 'mint' | 'container' | 'amber' | 'danger';
  /** Border colour override (used for confidence highlighting). */
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
}

const TONES = {
  surface: colors.surface,
  mint: colors.mintTint,
  container: colors.primaryContainer,
  amber: '#FFF1E6',
  danger: '#FDECEA',
} as const;

/** 16dp rounded card with the 2dp subtle elevation from design.md 6.1. */
export function Card({ tone = 'surface', borderColor, style, ...rest }: Props) {
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: TONES[tone],
          borderRadius: radius.lg,
          padding: 16,
          borderWidth: borderColor ? 2 : 1,
          borderColor: borderColor ?? colors.surfaceVariant,
        },
        elevation.card,
        style,
      ]}
    />
  );
}
