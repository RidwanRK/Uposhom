import { ABS } from '../theme/spacing';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/colors';
import { formatPercentBn, toBn } from '../utils/bangla';
import { Text } from './Text';

interface Props {
  /** 0-100, or null when nothing was due yet. */
  percent: number | null | undefined;
  size?: number;
  label?: string;
}

/** Circular adherence progress (design.md 6.1): '৮৫% সম্পন্ন'. */
export function AdherenceRing({ percent, size = 76, label = 'সম্পন্ন' }: Props) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={
        percent == null ? 'এখনো কোনো ডোজ বাকি পড়েনি' : `${toBn(Math.round(p))} শতাংশ ${label}`
      }
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surfaceVariant}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={p >= 80 ? colors.taken : colors.tertiary}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - p / 100)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.center}>
        <Text variant="labelLarge" style={{ color: colors.onSurface, fontSize: 16 }}>
          {percent == null ? '—' : formatPercentBn(p)}
        </Text>
        <Text variant="caption" style={{ fontSize: 11, lineHeight: 15 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...ABS, alignItems: 'center', justifyContent: 'center' },
});
