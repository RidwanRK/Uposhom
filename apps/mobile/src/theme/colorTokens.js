/* global module */
// Single source of truth for the colour tokens (design.md section 2 and 8).
// Plain CommonJS so tailwind.config.js can require it; src/theme/colors.ts re-exports it typed.
const colorTokens = {
  primary: '#0D5C52',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D1EAE5',
  onPrimaryContainer: '#042B26',
  mintTint: '#E8F5E9',
  secondary: '#276352',
  onSecondary: '#FFFFFF',
  tertiary: '#B33A00', // urgent amber
  onTertiary: '#FFFFFF',
  error: '#C62828', // 999 emergency
  onError: '#FFFFFF',
  background: '#F6FAF8',
  onBackground: '#1A2421',
  surface: '#FFFFFF',
  onSurface: '#1A2421',
  surfaceVariant: '#E4EDE9',
  onSurfaceVariant: '#3F4D49',
  outline: '#B2C7C1',
  taken: '#167347',
  snooze: '#B33A00',
  skip: '#566069',
  emergency: '#C62828',
};

module.exports = { colorTokens };
