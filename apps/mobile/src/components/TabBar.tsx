import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../theme/colors';
import { MIN_TOUCH, elevation } from '../theme/spacing';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * Accessible bottom bar with a high-contrast active pill and a visible label on every item
 * (design.md section 5). Used for the 4 family tabs and, with other routes, the 3 pharmacy tabs.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options;
        const focused = state.index === index;
        const label = options?.title ?? route.name;
        const icon = ((options as { tabBarIconName?: IconName } | undefined)?.tabBarIconName ??
          'circle') as IconName;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={label}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              const e = emitter.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !e.defaultPrevented) navigateToTab(route.key);
            }}
            style={styles.item}
          >
            <View style={[styles.pill, focused && { backgroundColor: colors.primaryContainer }]}>
              <Icon
                name={icon}
                size={26}
                color={focused ? 'onPrimaryContainer' : 'onSurfaceVariant'}
              />
            </View>
            <Text
              variant="caption"
              style={{
                color: focused ? colors.onPrimaryContainer : colors.onSurfaceVariant,
                fontWeight: focused ? '700' : '400',
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...elevation.bar,
  },
  item: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pill: { width: 64, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
