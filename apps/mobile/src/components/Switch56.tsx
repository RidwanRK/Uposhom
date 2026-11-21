import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH } from '../theme/spacing';
import { Text } from './Text';

interface Props {
  value: boolean;
  onValueChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** A labelled switch whose whole row is at least 56dp tall (design.md 6.3 critical toggle). */
export function Switch56({ value, onValueChange, label, hint, disabled }: Props) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.row, disabled && { opacity: 0.5 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleMedium">{label}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <View style={[styles.track, { backgroundColor: value ? colors.primary : colors.outline }]}>
        <View style={[styles.thumb, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { width: 64, height: 36, borderRadius: 18, padding: 3, justifyContent: 'center' },
  thumb: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surface },
});
