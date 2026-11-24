import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { MealTimes, Profile } from '@uposhom/shared';
import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { TextField } from '../src/components/TextField';
import { TimeStepper } from '../src/components/TimeStepper';
import { qk } from '../src/hooks/queries';
import { bn, useT } from '../src/i18n';
import { toLatinDigits } from '../src/utils/bangla';
import { errorMessage } from '../src/utils/errors';
import { normalizeBdMsisdn } from '../src/utils/phone';
import { OTP_MAX_DIGITS, cleanOtp, isOtpComplete } from '../src/utils/otp';

const RELS = ['FATHER', 'MOTHER', 'SON', 'DAUGHTER', 'SPOUSE', 'OTHER'] as const;
const DEFAULT_MEALS: MealTimes = {
  morning: '08:00',
  noon: '13:30',
  evening: '17:00',
  night: '20:30',
};

/**
 * Add Dependent (design.md 6.4). If the dependent has their own phone, a Family Link OTP step records
 * their explicit consent. The dialog first says what they are opting into, and the code lasts 5 minutes.
 */
export default function AddDependent() {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [rel, setRel] = useState<(typeof RELS)[number]>('FATHER');
  const [phone, setPhone] = useState('');
  const [meals, setMeals] = useState<MealTimes>(DEFAULT_MEALS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Profile | null>(null);
  const [msisdn, setMsisdn] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [otp, setOtp] = useState('');

  const save = async () => {
    if (!name.trim()) return setError(t('confirm.needFix'));
    const normalized = phone.trim() ? normalizeBdMsisdn(phone) : null;
    if (phone.trim() && !normalized) return setError(t('auth.phone.invalid'));
    setBusy(true);
    setError(null);
    try {
      const p = await api.circles.createProfile({
        name: name.trim(),
        age: age ? Number(toLatinDigits(age)) : undefined,
        relationship: rel,
        mealTimes: meals,
      });
      void qc.invalidateQueries({ queryKey: qk.circle });
      if (normalized) {
        setCreated(p);
        setMsisdn(normalized);
      } else {
        router.back();
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) router.replace('/premium');
      else
        setError(
          e instanceof ApiError && e.isNetwork
            ? t('common.noConnection')
            : t('common.errorGeneric'),
        );
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    if (!created || !msisdn) return;
    setBusy(true);
    setError(null);
    try {
      await api.circles.requestLink(created.id, msisdn);
      setCodeSent(true);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code in bn.auth.errors
          ? t(`auth.errors.${code as keyof typeof bn.auth.errors}`)
          : errorMessage(e, t),
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!created || !msisdn) return;
    setBusy(true);
    setError(null);
    try {
      await api.circles.verifyLink(created.id, msisdn, toLatinDigits(otp));
      void qc.invalidateQueries({ queryKey: qk.circle });
      router.back();
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <>
        <Header title={t('addDependent.consentTitle')} onBack={() => router.back()} />
        <Screen edges={['bottom']}>
          <Card tone="mint">
            <Text variant="bodyLarge" color="onSurface">
              {t('addDependent.consentBody')}
            </Text>
          </Card>
          {!codeSent ? (
            <>
              <Button label={t('addDependent.consentSend')} loading={busy} onPress={sendCode} />
              {error ? (
                <Text variant="bodyMedium" style={{ color: '#C62828' }}>
                  {error}
                </Text>
              ) : null}
            </>
          ) : (
            <>
              <TextField
                label={t('auth.otp.label')}
                value={otp}
                onChangeText={(v) => setOtp(cleanOtp(v))}
                keyboardType="number-pad"
                maxLength={OTP_MAX_DIGITS}
                error={error}
                style={{ fontSize: 28, textAlign: 'center', letterSpacing: 8 }}
              />
              <Button
                label={t('addDependent.consentVerify')}
                loading={busy}
                disabled={!isOtpComplete(otp)}
                onPress={verify}
              />
            </>
          )}
          <Button
            label={t('addDependent.consentSkip')}
            variant="ghost"
            onPress={() => router.back()}
          />
        </Screen>
      </>
    );
  }

  return (
    <>
      <Header title={t('addDependent.title')} />
      <Screen edges={['bottom']}>
        <TextField label={t('addDependent.name')} value={name} onChangeText={setName} />
        <TextField
          label={t('addDependent.age')}
          value={age}
          onChangeText={(v) => setAge(toLatinDigits(v).replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad"
        />
        <View style={{ gap: 6 }}>
          <Text variant="titleMedium">{t('addDependent.relationship')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {RELS.map((r) => (
              <Chip
                key={r}
                label={t(`family.relationship.${r}`)}
                selected={rel === r}
                onPress={() => setRel(r)}
              />
            ))}
          </View>
        </View>
        <TextField
          label={t('addDependent.phone')}
          hint={t('addDependent.phoneHint')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <View style={{ gap: 8 }}>
          <Text variant="titleMedium">{t('addDependent.mealTimes')}</Text>
          <TimeStepper
            label={t('addDependent.morning')}
            value={meals.morning}
            onChange={(v) => setMeals({ ...meals, morning: v })}
          />
          <TimeStepper
            label={t('addDependent.noon')}
            value={meals.noon}
            onChange={(v) => setMeals({ ...meals, noon: v })}
          />
          <TimeStepper
            label={t('addDependent.evening')}
            value={meals.evening}
            onChange={(v) => setMeals({ ...meals, evening: v })}
          />
          <TimeStepper
            label={t('addDependent.night')}
            value={meals.night}
            onChange={(v) => setMeals({ ...meals, night: v })}
          />
        </View>
        {error ? (
          <Text variant="bodyMedium" style={{ color: '#C62828' }}>
            {error}
          </Text>
        ) : null}
        <Button label={t('addDependent.save')} loading={busy} onPress={save} />
      </Screen>
    </>
  );
}
