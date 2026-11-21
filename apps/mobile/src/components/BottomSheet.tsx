import { ABS } from '../theme/spacing';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MIN_TOUCH } from '../theme/spacing';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Block closing by tapping outside (payment in flight). */
  dismissable?: boolean;
}

export function BottomSheet({ visible, onClose, title, children, dismissable = true }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismissable ? onClose : undefined}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={dismissable ? onClose : undefined}
          accessibilityLabel="বন্ধ করুন"
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.handle} />
          {title ? (
            <View style={styles.titleRow}>
              <Text variant="headlineSmall" style={{ flex: 1 }} accessibilityRole="header">
                {title}
              </Text>
              {dismissable ? (
                <Pressable
                  onPress={onClose}
                  style={styles.close}
                  accessibilityRole="button"
                  accessibilityLabel="বন্ধ করুন"
                >
                  <Icon name="close" size={26} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...ABS, backgroundColor: 'rgba(4,43,38,0.5)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '88%',
    gap: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.outline,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  close: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
});
