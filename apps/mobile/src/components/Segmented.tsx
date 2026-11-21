import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { Text } from './Text';

interface Props<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** Segmented button row (meal relation, Vault segments). 56dp tall. */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.seg, selected && styles.on]}
          >
            <Text
              variant="bodyMedium"
              style={{
                color: selected ? colors.onPrimary : colors.onSurface,
                textAlign: 'center',
                fontWeight: selected ? '700' : '400',
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  seg: {
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.primary },
});
