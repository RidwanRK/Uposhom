import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { colors } from '../theme/colors';

/**
 * Zoomable, pannable view of the captured prescription photo (design.md 6.3). The photo is shown as-is,
 * with no overlays: the person compares it with the parsed fields by eye.
 */
export function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      scale.value = Math.min(5, Math.max(1, savedScale.value * e.scale));
    },
    onDeactivate: () => {
      'worklet';
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    },
  });

  const pan = usePanGesture({
    minPointers: 1,
    onUpdate: (e) => {
      'worklet';
      if (scale.value > 1) {
        x.value = savedX.value + e.translationX;
        y.value = savedY.value + e.translationY;
      }
    },
    onDeactivate: () => {
      'worklet';
      savedX.value = x.value;
      savedY.value = y.value;
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onDeactivate: () => {
      'worklet';
      const target = scale.value > 1 ? 1 : 2.5;
      scale.value = withTiming(target);
      savedScale.value = target;
      if (target === 1) {
        x.value = withTiming(0);
        y.value = withTiming(0);
        savedX.value = 0;
        savedY.value = 0;
      }
    },
  });

  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <View style={styles.frame} accessible accessibilityLabel="প্রেসক্রিপশনের ছবি">
      <GestureDetector gesture={gesture}>
        <Animated.View style={[StyleSheet.absoluteFill, style]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: '#0B1412',
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.primary,
  },
});
