import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { Icon } from './Icon';

interface Props {
  active: boolean;
  busy?: boolean;
  onPress: () => void;
  label: string;
  /** 0-1 live input level. Without metering the orb pulses on a gentle sine instead. */
  level?: number;
}

/** 80dp animated microphone orb with radiating ripples while active (design.md 6.7 and section 7). */
export function MicOrb({ active, busy, onPress, label }: Props) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  const ripple = useSharedValue(0);

  useEffect(() => {
    if (active && !reduce) {
      pulse.value = withRepeat(
        withTiming(1.15, { duration: 700, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
      ripple.value = 0;
      ripple.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      cancelAnimation(ripple);
      pulse.value = withTiming(1);
      ripple.value = 0;
    }
  }, [active, reduce, pulse, ripple]);

  const orb = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  const r1 = useAnimatedStyle(() => ({
    opacity: active ? 0.45 * (1 - ripple.value) : 0,
    transform: [{ scale: 1 + ripple.value * 1.1 }],
  }));
  const r2 = useAnimatedStyle(() => {
    const p = (ripple.value + 0.5) % 1;
    return { opacity: active ? 0.35 * (1 - p) : 0, transform: [{ scale: 1 + p * 1.1 }] };
  });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.ripple, r1]} />
      <Animated.View style={[styles.ripple, r2]} />
      <Animated.View style={orb}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          disabled={busy}
          style={[
            styles.orb,
            { backgroundColor: active ? colors.emergency : colors.primary },
            busy && { opacity: 0.6 },
          ]}
        >
          <Icon name={active ? 'stop' : 'microphone'} size={38} color="onPrimary" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const SIZE = 80;
const styles = StyleSheet.create({
  wrap: {
    width: SIZE * 2.4,
    height: SIZE * 2.4,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  ripple: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.primary,
  },
  orb: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
