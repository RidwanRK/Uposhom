import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../../src/components/Icon';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { colors } from '../../src/theme/colors';
import { MIN_TOUCH, elevation, radius } from '../../src/theme/spacing';

/** Sign-up step 1: account type. One question per screen. Decides 4 tabs or the pharmacy 3 tabs. */
export default function AccountType() {
  const t = useT();
  const setType = useSession((s) => s.setPendingAccountType);
  const choose = (type: 'INDIVIDUAL' | 'PHARMACY') => {
    setType(type);
    router.push('/(auth)/phone');
  };
  return (
    <Screen contentStyle={{ gap: 20, paddingTop: 32 }}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Icon name="medical-bag" size={44} color="onPrimary" />
        </View>
        <Text variant="headlineLarge" color="primary">
          উপশম
        </Text>
      </View>
      <Text variant="headlineMedium" style={{ textAlign: 'center' }} accessibilityRole="header">
        {t('auth.accountType.title')}
      </Text>
      <TypeCard
        icon="account-group"
        title={t('auth.accountType.family')}
        sub={t('auth.accountType.familySub')}
        onPress={() => choose('INDIVIDUAL')}
      />
      <TypeCard
        icon="store-plus"
        title={t('auth.accountType.pharmacy')}
        sub={t('auth.accountType.pharmacySub')}
        onPress={() => choose('PHARMACY')}
      />
    </Screen>
  );
}

function TypeCard({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      // A plain style array: NativeWind's Pressable wrapper can drop a style function.
      style={[styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.iconWrap}>
        <Icon name={icon} size={34} color="primary" />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="titleMedium">{title}</Text>
        <Text variant="bodyMedium">{sub}</Text>
      </View>
      <Icon name="chevron-right" size={28} color="onSurfaceVariant" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: 8 },
  logo: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    minHeight: MIN_TOUCH * 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.primaryContainer,
    ...elevation.card,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
