import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { useActiveProfile, useAlerts } from '../hooks/queries';
import { colors } from '../theme/colors';
import { MIN_TOUCH, radius } from '../theme/spacing';
import { toBn } from '../utils/bangla';
import { BottomSheet } from './BottomSheet';
import { Icon, type IconName } from './Icon';
import { Avatar } from './Misc';
import { Text } from './Text';

/** UPOSHOM top app bar (design.md section 5): dependent switcher, mic, bell with count, scan camera. */
export function TopBar() {
  const t = useT();
  const { profile, profiles, setActive } = useActiveProfile();
  const { data } = useAlerts();
  const [open, setOpen] = useState(false);
  const unread = (data?.alerts ?? []).filter((a) => !a.acknowledged).length;

  return (
    <SafeAreaView edges={['top']} style={styles.bar}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('topBar.switcher')}
          onPress={() => profiles.length > 1 && setOpen(true)}
          style={styles.switcher}
        >
          <Avatar emoji={profile?.avatar} size={36} />
          <Text
            variant="titleMedium"
            style={{ color: colors.onPrimary, flexShrink: 1 }}
            numberOfLines={1}
          >
            {profile?.name ?? '…'}
          </Text>
          {profiles.length > 1 ? <Icon name="chevron-down" size={22} color="onPrimary" /> : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        <IconBtn icon="microphone" label={t('topBar.mic')} onPress={() => router.push('/voice')} />
        <IconBtn
          icon="bell-outline"
          label={t('topBar.bell')}
          badge={unread}
          onPress={() => router.push('/alerts')}
        />
        <IconBtn
          icon="camera-outline"
          label={t('topBar.scan')}
          onPress={() => router.push('/scan')}
        />
      </View>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={t('topBar.switcherTitle')}>
        {profiles.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            onPress={() => {
              setActive(p.id);
              setOpen(false);
            }}
            style={[
              styles.option,
              p.id === profile?.id && { backgroundColor: colors.primaryContainer },
            ]}
          >
            <Avatar emoji={p.avatar} />
            <Text variant="titleMedium" style={{ flex: 1 }}>
              {p.name}
            </Text>
            {p.id === profile?.id ? <Icon name="check-circle" size={26} color="primary" /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </SafeAreaView>
  );
}

function IconBtn({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.iconBtn}
      android_ripple={{ color: 'rgba(255,255,255,0.25)', borderless: true }}
    >
      <Icon name={icon} size={26} color="onPrimary" />
      {badge ? (
        <View style={styles.badge}>
          <Text
            variant="caption"
            style={{ color: colors.onError, fontSize: 11, lineHeight: 14, fontWeight: '700' }}
          >
            {toBn(badge > 9 ? '9+' : badge)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.primary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: MIN_TOUCH + 8,
    gap: 2,
  },
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: MIN_TOUCH,
    paddingHorizontal: 8,
    flexShrink: 1,
    maxWidth: '58%',
  },
  iconBtn: {
    width: MIN_TOUCH - 6,
    height: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.emergency,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: MIN_TOUCH,
    padding: 10,
    borderRadius: radius.md,
  },
});
