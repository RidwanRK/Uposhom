import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { fonts } from '../theme/typography';
import { radius } from '../theme/spacing';
import { toBn } from '../utils/bangla';
import { OTP_LENGTH, cleanOtp } from '../utils/otp';
import { Text } from './Text';

interface Props {
  value: string;
  onChange: (otp: string) => void;
  /** Read aloud by screen readers. */
  label: string;
  error?: string | null;
  autoFocus?: boolean;
}

/**
 * One box per digit (OTP_LENGTH of them), over a single hidden input, so the keyboard, paste and
 * Android's SMS code autofill all work as usual. Tapping any box opens the keyboard. Digits are
 * shown in Bangla; the value stays Latin for the server.
 */
export function OtpBoxes({ value, onChange, label, error, autoFocus }: Props) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const boxes = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '');
  const active = Math.min(value.length, OTP_LENGTH - 1);

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="none"
        onPress={() => input.current?.focus()}
        style={styles.row}
        importantForAccessibility="no-hide-descendants"
      >
        {boxes.map((d, i) => (
          <View
            key={i}
            style={[
              styles.box,
              d ? styles.filled : null,
              i === active && value.length < OTP_LENGTH ? styles.current : null,
              error ? styles.errorBox : null,
            ]}
          >
            <Text variant="headlineLarge" color="onSurface" style={styles.digit}>
              {d ? toBn(d) : ''}
            </Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel={label}
        value={value}
        onChangeText={(v) => onChange(cleanOtp(v))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={OTP_LENGTH}
        autoFocus={autoFocus}
        caretHidden
        style={styles.hidden}
      />
      {error ? (
        <Text
          variant="bodyMedium"
          style={{ color: colors.emergency, textAlign: 'center' }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  box: {
    width: 54,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.outline,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filled: { borderColor: colors.primary, backgroundColor: colors.mintTint },
  current: { borderColor: colors.primary, borderWidth: 3 },
  errorBox: { borderColor: colors.emergency },
  digit: { fontFamily: fonts.bold, textAlign: 'center' },
  // Off screen but still focusable, so the system keyboard and SMS autofill target it.
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
});
