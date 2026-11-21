import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { useSettings, TEXT_SCALE_LARGE } from '../store/settings';
import { Text } from './Text';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
  hint?: string;
}

export function TextField({ label, error, hint, style, multiline, ...rest }: Props) {
  const large = useSettings((s) => s.largeText);
  const size = 16 * (large ? TEXT_SCALE_LARGE : 1);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="titleMedium">{label}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.onSurfaceVariant}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        {...rest}
        style={[
          styles.input,
          {
            fontSize: size,
            lineHeight: size * 1.4,
            borderColor: error ? colors.emergency : colors.outline,
            minHeight: multiline ? 112 : MIN_TOUCH,
          },
          style,
        ]}
      />
      {error ? (
        <Text
          variant="bodyMedium"
          style={{ color: colors.emergency }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    fontFamily: fonts.regular,
    includeFontPadding: false,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
