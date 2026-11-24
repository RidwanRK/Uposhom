import { ABS } from '../src/theme/spacing';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { isMockedPath } from '../src/api/config';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Icon, type IconName } from '../src/components/Icon';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useActiveProfile } from '../src/hooks/queries';
import { usePaymentGate } from '../src/hooks/usePaymentGate';
import { useT } from '../src/i18n';
import { useDraft } from '../src/store/draft';
import { colors } from '../src/theme/colors';
import { MIN_TOUCH } from '../src/theme/spacing';
import { prepareImage } from '../src/utils/image';
import { openAppSettings } from '../src/utils/permissions';

/** Screen 2: camera prescription scanner (design.md 6.2). Preprocesses on the phone, then uploads. */
export default function Scan() {
  const t = useT();
  const { profile } = useActiveProfile();
  const gate = usePaymentGate();
  const startDraft = useDraft((s) => s.start);
  const startManual = useDraft((s) => s.startManual);
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  // Coming back from Settings (where a blocked camera is switched on): look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<CameraView>(null);
  const { width, height } = useWindowDimensions();
  const flash = useSharedValue(0);

  const frameW = width * 0.88;
  const frameH = Math.min(height * 0.58, frameW * 1.35);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  const process = async (uri: string, w?: number, h?: number) => {
    setBusy(true);
    setError(null);
    try {
      const file = await prepareImage(uri, w, h);
      const upload = () => api.prescriptions.uploadAndParse(file, profile?.id);
      let res;
      try {
        res = await upload();
      } catch (e) {
        // Over the monthly free quota: offer the pay-per-use sheet, then repeat the scan.
        if (gate.paymentPurpose(e) && (await gate.requestPayment('SCAN'))) res = await upload();
        else throw e;
      }
      startDraft({
        // When the live server has no upload route yet the draft id is the mock's, so confirm as 'new'.
        draftId: isMockedPath('POST', '/prescriptions/upload-and-parse')
          ? null
          : res.draftPrescriptionId,
        imageUri: file.uri,
        transcript: res.transcribedText,
        items: res.extractedItems,
      });
      router.replace('/confirm');
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? t('common.noConnection') : t('scan.failed'));
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (busy || !camera.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    flash.value = withSequence(withTiming(1, { duration: 40 }), withTiming(0, { duration: 60 })); // 100ms shutter flash
    try {
      const pic = await camera.current.takePictureAsync({ quality: 1, skipProcessing: false });
      await process(pic.uri, pic.width, pic.height);
    } catch {
      setError(t('scan.failed'));
    }
  };

  const pickFromGallery = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (!r.canceled && r.assets[0])
      await process(r.assets[0].uri, r.assets[0].width, r.assets[0].height);
  };

  const typeInstead = () => {
    startManual();
    router.replace('/confirm');
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  if (!permission.granted) {
    return (
      <Screen contentStyle={{ gap: 18, paddingTop: 48, alignItems: 'stretch' }}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <Icon name="camera-off-outline" size={64} color="primary" />
          <Text variant="headlineMedium" style={{ textAlign: 'center' }}>
            {t('scan.permissionTitle')}
          </Text>
          <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
            {permission.canAskAgain ? t('scan.permissionBody') : t('scan.blocked')}
          </Text>
        </View>
        {permission.canAskAgain ? (
          <Button label={t('scan.grant')} onPress={() => void requestPermission()} />
        ) : (
          <Button
            label={t('common.openSettings')}
            icon="cog-outline"
            onPress={() => void openAppSettings()}
          />
        )}
        <Button
          label={t('scan.gallery')}
          icon="image-outline"
          variant="secondary"
          onPress={pickFromGallery}
        />
        <Button label={t('scan.typedFallback')} variant="ghost" onPress={typeInstead} />
        <Button label={t('common.close')} variant="ghost" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} />

      {/* Semi-transparent vignette around a rounded target frame. */}
      <View style={styles.overlay} pointerEvents="none">
        <View style={[styles.mask, { flex: 1 }]} />
        <View style={{ flexDirection: 'row', height: frameH }}>
          <View style={[styles.mask, { flex: 1 }]} />
          <View style={[styles.frame, { width: frameW, height: frameH }]} />
          <View style={[styles.mask, { flex: 1 }]} />
        </View>
        <View style={[styles.mask, { flex: 1.25 }]} />
      </View>

      <SafeAreaView style={styles.top} edges={['top']} pointerEvents="box-none">
        <View style={styles.topRow}>
          <RoundBtn icon="close" label={t('common.close')} onPress={() => router.back()} />
          <View style={{ flex: 1 }} />
          <RoundBtn
            icon={torch ? 'flash' : 'flash-off'}
            label={t('scan.flash')}
            onPress={() => setTorch((v) => !v)}
            active={torch}
          />
          <RoundBtn icon="image-outline" label={t('scan.gallery')} onPress={pickFromGallery} />
        </View>
      </SafeAreaView>

      <SafeAreaView style={styles.bottom} edges={['bottom']} pointerEvents="box-none">
        <Text variant="bodyLarge" style={styles.instruction} accessibilityLiveRegion="polite">
          {error ?? t('scan.instruction')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('scan.capture')}
          onPress={capture}
          disabled={busy}
          style={styles.shutterOuter}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={typeInstead} style={styles.typeBtn}>
          <Text variant="titleMedium" style={{ color: '#fff', textDecorationLine: 'underline' }}>
            {t('scan.typedFallback')}
          </Text>
        </Pressable>
      </SafeAreaView>

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: '#fff' }, flashStyle]}
      />

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator size="large" color="#fff" />
          <Text variant="titleMedium" style={{ color: '#fff' }}>
            {t('scan.processing')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function RoundBtn({
  icon,
  label,
  onPress,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.round, active && { backgroundColor: colors.primary }]}
    >
      <Icon name={icon} size={26} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { ...ABS },
  mask: { backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: { borderWidth: 3, borderColor: colors.primary, borderRadius: 18 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  round: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: MIN_TOUCH / 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 14,
    paddingBottom: 12,
  },
  instruction: { color: '#fff', textAlign: 'center', paddingHorizontal: 24 },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  typeBtn: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  busy: {
    ...ABS,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
});
