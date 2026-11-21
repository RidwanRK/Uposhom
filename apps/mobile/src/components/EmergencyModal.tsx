import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

interface Props {
  visible: boolean;
  message?: string;
  dial?: string;
  onDismiss: () => void;
}

/**
 * 999 Emergency Interruption (design.md 6.7): full screen, solid crimson header, one big call button.
 * Triggered by the deterministic keyword guard, before any AI call.
 */
export function EmergencyModal({ visible, message, dial = 'tel:999', onDismiss }: Props) {
  const t = useT();

  useEffect(() => {
    if (visible)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <View style={styles.headerRow}>
            <Icon name="alert" size={44} color="onError" />
            <Text
              variant="headlineMedium"
              style={{ color: colors.onError }}
              accessibilityRole="header"
            >
              {t('emergency.title')}
            </Text>
          </View>
        </SafeAreaView>
        <ScrollView contentContainerStyle={styles.body}>
          <Text
            variant="headlineSmall"
            style={{ textAlign: 'center' }}
            accessibilityLiveRegion="assertive"
          >
            {message || t('emergency.message')}
          </Text>
          <Button
            label={t('emergency.call')}
            icon="phone"
            variant="danger"
            onPress={() => void Linking.openURL(dial)}
            style={styles.call}
          />
          <Button label={t('emergency.dismiss')} variant="ghost" onPress={onDismiss} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.emergency },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20 },
  body: { padding: 24, gap: 24, justifyContent: 'center', flexGrow: 1 },
  call: { minHeight: 72 },
});
