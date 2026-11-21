import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useSettings, TEXT_SCALE_LARGE } from '../store/settings';
import { colors, type ColorName } from '../theme/colors';
import { typography, type TypographyVariant } from '../theme/typography';

type Props = TextProps & {
  variant?: TypographyVariant;
  /** Colour token name, e.g. 'primary' or 'onSurfaceVariant'. */
  color?: ColorName;
};

/**
 * The only text component the app uses (never the raw React Native Text). Every variant carries an
 * explicit lineHeight and includeFontPadding:false so Bangla matras do not clip on Android, and the
 * larger-text setting scales font size and line height together to keep the 1.35x to 1.45x ratio.
 */
export function Text({ variant = 'bodyLarge', color, style, ...rest }: Props) {
  const large = useSettings((s) => s.largeText);
  const base = typography[variant] as TextStyle & { fontSize: number; lineHeight: number };
  const scaled: TextStyle = large
    ? { fontSize: base.fontSize * TEXT_SCALE_LARGE, lineHeight: base.lineHeight * TEXT_SCALE_LARGE }
    : {};
  return (
    <RNText {...rest} style={[base, scaled, color ? { color: colors[color] } : null, style]} />
  );
}
