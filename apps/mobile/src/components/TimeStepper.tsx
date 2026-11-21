import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { formatHHmmBn } from '../utils/bangla';
import { Icon } from './Icon';
import { Text } from './Text';

function shift(hhmm: string, deltaMin: number): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const total = (((h * 60 + m + deltaMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Pick a clock time in 30 minute steps with two 56dp buttons. Shows 'সকাল ০৮:০০' style text. */
export function TimeStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View
      style={styles.row}
      accessibilityRole="adjustable"
      accessibilityLabel={`${label} ${formatHHmmBn(value)}`}
    >
      <Text variant="titleMedium" style={{ width: 70 }}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="আধা ঘণ্টা আগে"
        onPress={() => onChange(shift(value, -30))}
        style={styles.btn}
      >
        <Icon name="minus" size={24} color="primary" />
      </Pressable>
      <Text variant="titleMedium" style={{ flex: 1, textAlign: 'center' }}>
        {formatHHmmBn(value)}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="আধা ঘণ্টা পরে"
        onPress={() => onChange(shift(value, 30))}
        style={styles.btn}
      >
        <Icon name="plus" size={24} color="primary" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btn: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
