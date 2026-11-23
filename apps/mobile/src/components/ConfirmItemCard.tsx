import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { MealRelation } from '@uposhom/shared';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import type { DraftItem } from '../store/draft';
import { colors } from '../theme/colors';
import { MIN_TOUCH } from '../theme/spacing';
import { toBn, toLatinDigits } from '../utils/bangla';
import {
  DURATION_STEPS,
  PATTERN_CHIPS,
  displayPattern,
  durationLabelBn,
  normalizePattern,
} from '../utils/patterns';
import { Button } from './Button';
import { Card } from './Card';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Stepper } from './Misc';
import { Segmented } from './Segmented';
import { Switch56 } from './Switch56';
import { Text } from './Text';
import { TextField } from './TextField';

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection'] as const;
const FORM_LABEL: Record<(typeof FORMS)[number], string> = {
  Tablet: 'ট্যাবলেট',
  Capsule: 'ক্যাপসুল',
  Syrup: 'সিরাপ',
  Injection: 'ইনজেকশন',
};

export interface ItemErrors {
  brand?: boolean;
  pattern?: boolean;
  duration?: boolean;
  /** Why the schedule engine would not schedule this item (already in Bangla). */
  reasons?: string[];
}

interface Props {
  item: DraftItem;
  index: number;
  errors?: ItemErrors;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}

/**
 * One editable medicine card (design.md 6.3). The border is the confidence indicator: crisp teal at 90%
 * and above, amber with "please re-verify" below. The critical switch always starts off and only a
 * person can turn it on.
 */
export function ConfirmItemCard({ item, index, errors, onChange, onRemove }: Props) {
  const t = useT();
  const low = item.confidence < 0.9 && !item.manual;
  const [focused, setFocused] = useState(false);
  const [manualPattern, setManualPattern] = useState(() =>
    (PATTERN_CHIPS as readonly string[]).includes(item.pattern) ? '' : item.pattern,
  );

  const q = item.brandName.trim();
  const suggest = useQuery({
    queryKey: ['suggest', q],
    enabled: focused && q.length >= 2,
    queryFn: () => api.drugs.search(q),
    staleTime: 60_000,
  });

  // keep the manual box in sync when a chip is picked
  useEffect(() => {
    if ((PATTERN_CHIPS as readonly string[]).includes(item.pattern)) setManualPattern('');
  }, [item.pattern]);

  const patternState = normalizePattern(item.pattern);
  const showSuggestions =
    focused &&
    (suggest.data?.results.length ?? 0) > 0 &&
    !(
      suggest.data?.results.length === 1 &&
      suggest.data.results[0]?.nameEn.toLowerCase() === q.toLowerCase()
    );

  return (
    <Card
      borderColor={low ? colors.tertiary : colors.primary}
      style={{ gap: 14 }}
      accessibilityLabel={`${t('confirm.tabItems')} ${toBn(index + 1)}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="titleLarge" style={{ flex: 1 }}>
          {toBn(index + 1)}. {item.brandName || t('confirm.brand')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('confirm.removeItem')}
          onPress={onRemove}
          style={{
            width: MIN_TOUCH,
            height: MIN_TOUCH,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="trash-can-outline" size={26} color="emergency" />
        </Pressable>
      </View>

      {errors?.reasons?.length ? (
        <View
          style={{ gap: 4, backgroundColor: '#FDECEA', padding: 10, borderRadius: 10 }}
          accessibilityLiveRegion="polite"
        >
          {errors.reasons.map((r) => (
            <Text key={r} variant="bodyMedium" style={{ color: colors.emergency }}>
              • {r}
            </Text>
          ))}
        </View>
      ) : null}

      {low ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            backgroundColor: '#FFF1E6',
            padding: 10,
            borderRadius: 10,
          }}
        >
          <Icon name="alert" size={22} color="tertiary" />
          <Text variant="titleMedium" style={{ color: colors.tertiary, flex: 1 }}>
            {t('confirm.reverify')}
          </Text>
        </View>
      ) : null}

      <View>
        <TextField
          label={t('confirm.brand')}
          value={item.brandName}
          onChangeText={(v) => onChange({ brandName: v })}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder={t('confirm.brandPlaceholder')}
          error={errors?.brand ? t('confirm.needFix') : null}
        />
        {showSuggestions ? (
          <View style={{ gap: 6, marginTop: 6 }}>
            {suggest.data?.results.slice(0, 4).map((d) => (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                onPress={() => {
                  onChange({
                    brandName: d.nameEn,
                    genericName: d.generic,
                    strength: d.strength,
                    form: d.form,
                  });
                  setFocused(false);
                }}
                style={{
                  minHeight: MIN_TOUCH,
                  backgroundColor: colors.mintTint,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  justifyContent: 'center',
                }}
              >
                <Text variant="titleMedium">
                  {d.nameEn}{' '}
                  <Text variant="bodyMedium">
                    {d.nameBn} · {d.generic} {d.strength}
                  </Text>
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <TextField
        label={t('confirm.strength')}
        value={item.strength}
        onChangeText={(v) => onChange({ strength: v })}
        placeholder="500mg"
        autoCapitalize="none"
      />

      <View style={{ gap: 6 }}>
        <Text variant="titleMedium">{t('confirm.form')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FORMS.map((f) => (
            <Chip
              key={f}
              label={FORM_LABEL[f]}
              selected={item.form.toLowerCase() === f.toLowerCase()}
              onPress={() => onChange({ form: f })}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="titleMedium">{t('confirm.pattern')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PATTERN_CHIPS.map((p) => (
            <Chip
              key={p}
              label={displayPattern(p)}
              selected={item.pattern === p}
              onPress={() => onChange({ pattern: p })}
            />
          ))}
        </View>
        <TextField
          value={manualPattern}
          onChangeText={(v) => {
            setManualPattern(v);
            const r = normalizePattern(v);
            onChange({ pattern: r.valid ? r.canonical : toLatinDigits(v) });
          }}
          placeholder={t('confirm.patternManual')}
          error={
            errors?.pattern || (manualPattern !== '' && !patternState.valid)
              ? t('confirm.patternInvalid')
              : null
          }
          autoCapitalize="characters"
        />
        {!patternState.valid && item.pattern !== '' && manualPattern === '' ? (
          <Text variant="caption" style={{ color: colors.tertiary }}>
            {t('confirm.patternInvalid')}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="titleMedium">{t('confirm.meal')}</Text>
        <Segmented<MealRelation>
          value={item.mealRelation}
          onChange={(m) => onChange({ mealRelation: m })}
          options={[
            { value: 'AC', label: t('dose.mealAC') },
            { value: 'PC', label: t('dose.mealPC') },
            { value: 'WITH_MEAL', label: t('dose.mealWith') },
          ]}
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text variant="titleMedium">{t('confirm.duration')}</Text>
        <Stepper
          value={item.durationDays}
          onChange={(n) => onChange({ durationDays: n })}
          label={durationLabelBn(item.durationDays)}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DURATION_STEPS.map((d) => (
            <Chip
              key={d}
              label={durationLabelBn(d)}
              selected={item.durationDays === d}
              onPress={() => onChange({ durationDays: d })}
            />
          ))}
        </View>
        {errors?.duration ? (
          <Text variant="bodyMedium" style={{ color: colors.emergency }}>
            {t('confirm.needFix')}
          </Text>
        ) : null}
      </View>

      <TextField
        label={t('confirm.pillCount')}
        hint={t('confirm.pillCountHint')}
        value={item.pillCount ? String(item.pillCount) : ''}
        onChangeText={(v) => {
          const n = Number(toLatinDigits(v).replace(/\D/g, ''));
          onChange({ pillCount: n > 0 ? n : undefined });
        }}
        keyboardType="number-pad"
      />

      <Switch56
        value={item.isCritical}
        onValueChange={(v) => onChange({ isCritical: v })}
        label={t('confirm.critical')}
        hint={t('confirm.criticalHint')}
      />

      <Button
        label={t('confirm.removeItem')}
        variant="ghost"
        icon="trash-can-outline"
        onPress={onRemove}
      />
    </Card>
  );
}
