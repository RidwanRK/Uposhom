import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { TIPS } from '../data/tips';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { toBn } from '../utils/bangla';
import { Icon } from './Icon';
import { Text } from './Text';

const INTERVAL_MS = 6000;

/**
 * Health Advice Carousel (design.md 6.1): mintTint card, auto-swipes every 6s. It never moves against
 * the user's will: it pauses while touched, stops entirely when Android's "remove animations" is on,
 * and always has manual swipe plus position dots.
 */
export function FactsCarousel() {
  const t = useT();
  const listRef = useRef<FlatList>(null);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const goTo = useCallback(
    (i: number) => {
      listRef.current?.scrollToOffset({ offset: i * width, animated: !reduceMotion });
      setIndex(i);
    },
    [width, reduceMotion],
  );

  useEffect(() => {
    if (reduceMotion || touching || width === 0) return;
    const timer = setInterval(() => goTo((index + 1) % TIPS.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [reduceMotion, touching, width, index, goTo]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      style={styles.card}
      onLayout={onLayout}
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
      accessibilityLabel={t('tips.title')}
    >
      <View style={styles.header}>
        <Icon name="lightbulb-on-outline" size={20} color="primary" />
        <Text variant="titleLarge" style={{ flex: 1 }}>
          {t('tips.title')}
        </Text>
        <Text variant="caption">
          {t('tips.position', { n: toBn(index + 1), total: toBn(TIPS.length) })}
        </Text>
      </View>
      {width > 0 ? (
        <FlatList
          ref={listRef}
          data={TIPS}
          keyExtractor={(i) => i.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          onScrollBeginDrag={() => setTouching(true)}
          onScrollEndDrag={() => setTouching(false)}
          renderItem={({ item }) => (
            <View style={{ width: width - 0, paddingHorizontal: 16, paddingBottom: 6 }}>
              <Text variant="bodyLarge" color="onSurface" style={{ minHeight: 72 }}>
                {item.text}
              </Text>
            </View>
          )}
        />
      ) : null}
      <View style={styles.dots}>
        {TIPS.map((tip, i) => (
          <View key={tip.id} style={[styles.dot, i === index && styles.dotOn]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.mintTint,
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingTop: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.outline },
  dotOn: { width: 20, backgroundColor: colors.primary },
});
