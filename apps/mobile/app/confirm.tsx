import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api/endpoints';
import { BottomSheet } from '../src/components/BottomSheet';
import { Button } from '../src/components/Button';
import { Chip } from '../src/components/Chip';
import { ConfirmItemCard, type ItemErrors } from '../src/components/ConfirmItemCard';
import { Header } from '../src/components/Header';
import { Icon } from '../src/components/Icon';
import { Banner } from '../src/components/Misc';
import { Text } from '../src/components/Text';
import { ZoomableImage } from '../src/components/ZoomableImage';
import { qk, useActiveProfile } from '../src/hooks/queries';
import { useT } from '../src/i18n';
import { useDraft } from '../src/store/draft';
import { colors } from '../src/theme/colors';
import { elevation } from '../src/theme/spacing';
import { toBn } from '../src/utils/bangla';
import { errorMessage, manualInputProblems, reasonText } from '../src/utils/errors';
import { normalizePattern } from '../src/utils/patterns';

/**
 * Screen 3: side-by-side visual confirmation (safety critical). No schedule is created until a person
 * has compared the photo with every parsed field and pressed confirm. The AI never decides a dose.
 */
export default function Confirm() {
  const t = useT();
  const { height } = useWindowDimensions();
  const qc = useQueryClient();
  const { profile, profiles, setActive } = useActiveProfile();
  const { draftId, imageUri, transcript, items, update, add, remove, reset } = useDraft();
  const [showText, setShowText] = useState(false);
  const [errors, setErrors] = useState<Record<string, ItemErrors>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number; summary: string } | null>(null);

  const hasImage = !!imageUri;
  const topHeight = Math.round(height * 0.4);

  const validate = (): boolean => {
    const e: Record<string, ItemErrors> = {};
    for (const i of items) {
      const err: ItemErrors = {};
      if (!i.brandName.trim()) err.brand = true;
      if (!normalizePattern(i.pattern).valid) err.pattern = true;
      if (!(i.durationDays >= 1)) err.duration = true;
      if (err.brand || err.pattern || err.duration) e[i.key] = err;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const confirm = async () => {
    setMessage(null);
    if (items.length === 0) {
      setMessage(t('confirm.noItems'));
      return;
    }
    if (!validate()) {
      setMessage(t('confirm.needFix'));
      return;
    }
    if (!profile) return;
    setBusy(true);
    try {
      const res = await api.prescriptions.confirm(
        draftId ?? 'new',
        profile.id,
        items.map((i) => ({
          brandName: i.brandName.trim(),
          dosageStrength: i.strength.trim(),
          form: i.form,
          parsedPattern: normalizePattern(i.pattern).canonical,
          mealRelation: i.mealRelation,
          durationDays: i.durationDays,
          isCritical: i.isCritical,
          pillCount: i.pillCount,
        })),
      );
      void qc.invalidateQueries({ queryKey: qk.doses(profile.id) });
      void qc.invalidateQueries({ queryKey: qk.circle });
      setSuccess({ count: res.scheduledEventsCount, summary: res.banglaSummary });
    } catch (e) {
      // The schedule engine never guesses: items it cannot schedule exactly come back with reasons.
      const problems = manualInputProblems(e);
      if (problems) {
        const mapped: Record<string, ItemErrors> = {};
        for (const p of problems) {
          const item = items[p.index];
          if (item) mapped[item.key] = { reasons: p.reasons.map((r) => reasonText(r, t)) };
        }
        setErrors(mapped);
        setMessage(t('confirm.needFix'));
      } else {
        setMessage(errorMessage(e, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    reset();
    setSuccess(null);
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header
        title={t('confirm.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />

      {hasImage ? (
        <View style={{ height: topHeight, padding: 10, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <ZoomableImage uri={imageUri} />
          </View>
          {transcript ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showText }}
              onPress={() => setShowText((v) => !v)}
              style={styles.strip}
            >
              <Icon name={showText ? 'chevron-down' : 'chevron-up'} size={24} color="primary" />
              <Text variant="titleMedium" style={{ flex: 1 }}>
                {t('confirm.transcript')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showText && transcript ? (
        <View style={styles.transcript}>
          <ScrollView style={{ maxHeight: height * 0.2 }}>
            <Text variant="bodyMedium" color="onSurface" selectable>
              {transcript}
            </Text>
          </ScrollView>
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="bodyLarge">{t('confirm.reviewHint')}</Text>
        {hasImage ? <Text variant="caption">{t('confirm.pinchHint')}</Text> : null}

        {profiles.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text variant="titleMedium">{t('confirm.forWhom')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {profiles.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  selected={p.id === profile?.id}
                  onPress={() => setActive(p.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {profile?.allergies ? (
          <Banner
            icon="alert-octagon-outline"
            text={t('confirm.allergyReminder', { text: profile.allergies })}
          />
        ) : null}

        {items.map((item, idx) => (
          <ConfirmItemCard
            key={item.key}
            item={item}
            index={idx}
            errors={errors[item.key]}
            onChange={(patch) => update(item.key, patch)}
            onRemove={() => remove(item.key)}
          />
        ))}
        {items.length === 0 ? (
          <Text variant="bodyLarge" style={{ textAlign: 'center' }}>
            {t('confirm.noItems')}
          </Text>
        ) : null}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.bar}>
        {message ? (
          <Text
            variant="bodyMedium"
            style={{ color: colors.emergency, textAlign: 'center' }}
            accessibilityLiveRegion="assertive"
          >
            {message}
          </Text>
        ) : null}
        <Button label={t('confirm.addMore')} variant="secondary" onPress={add} />
        <Button label={t('confirm.confirm')} loading={busy} onPress={confirm} />
      </SafeAreaView>

      <BottomSheet visible={!!success} onClose={finish} title={t('confirm.successTitle')}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Icon name="check-circle" size={56} color="taken" />
          <Text variant="titleMedium">
            {t('confirm.successCount', { n: toBn(success?.count ?? 0) })}
          </Text>
        </View>
        <View style={{ backgroundColor: colors.mintTint, padding: 14, borderRadius: 12 }}>
          <Text variant="bodyLarge" color="onSurface">
            {success?.summary}
          </Text>
        </View>
        <Button label={t('confirm.goHome')} onPress={finish} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 16, paddingBottom: 24 },
  strip: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.mintTint,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  transcript: {
    marginHorizontal: 10,
    marginBottom: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.mintTint,
  },
  bar: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...elevation.bar,
  },
});
