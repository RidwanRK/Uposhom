import type { TextStyle } from 'react-native';
import { colors } from './colors';

export const fonts = {
  regular: 'NotoSansBengali-Regular',
  medium: 'NotoSansBengali-Medium',
  semibold: 'NotoSansBengali-SemiBold',
  bold: 'NotoSansBengali-Bold',
} as const;

/**
 * Every Bangla style sets lineHeight at 1.35x to 1.45x the font size and includeFontPadding:false,
 * so matras and conjuncts (ী ূ ৈ ৌ ্র) are not clipped on Android (design.md section 3.2).
 */
const base: TextStyle = { includeFontPadding: false, color: colors.onSurface };

export const typography = {
  headlineLarge: { ...base, fontFamily: fonts.bold, fontSize: 28, lineHeight: 38 },
  headlineMedium: { ...base, fontFamily: fonts.semibold, fontSize: 22, lineHeight: 30 },
  headlineSmall: { ...base, fontFamily: fonts.semibold, fontSize: 20, lineHeight: 28 },
  titleLarge: {
    ...base,
    fontFamily: fonts.semibold,
    fontSize: 18,
    lineHeight: 26,
    color: colors.primary,
  },
  titleMedium: { ...base, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23 },
  bodyLarge: { ...base, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  bodyMedium: {
    ...base,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.onSurfaceVariant,
  },
  caption: {
    ...base,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.onSurfaceVariant,
  },
  labelLarge: {
    ...base,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.onPrimary,
  },
  numberLarge: {
    ...base,
    fontFamily: fonts.bold,
    fontSize: 30,
    lineHeight: 42,
    color: colors.primary,
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
