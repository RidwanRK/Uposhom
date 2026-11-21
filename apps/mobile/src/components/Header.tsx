import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MIN_TOUCH } from '../theme/spacing';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
  /** Hide the back arrow (root-level screens). */
  noBack?: boolean;
  tone?: 'primary' | 'plain';
}

/** Stack screen header: 56dp back button, title, optional right action. */
export function Header({ title, right, onBack, noBack, tone = 'primary' }: Props) {
  const dark = tone === 'primary';
  const fg = dark ? colors.onPrimary : colors.onSurface;
  return (
    <SafeAreaView
      edges={['top']}
      style={{ backgroundColor: dark ? colors.primary : colors.background }}
    >
      <View style={styles.row}>
        {noBack ? (
          <View style={{ width: 16 }} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="পেছনে"
            onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
            style={styles.btn}
            android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
          >
            <Icon name="arrow-left" size={26} color={fg} />
          </Pressable>
        )}
        <Text
          variant="headlineSmall"
          style={{ color: fg, flex: 1 }}
          numberOfLines={1}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <View style={styles.right}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: MIN_TOUCH + 8, flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  btn: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', alignItems: 'center' },
});
