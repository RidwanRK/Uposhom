import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { ApiError } from '../../src/api/client';
import { api } from '../../src/api/endpoints';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Header } from '../../src/components/Header';
import { Icon } from '../../src/components/Icon';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { useT, bn } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { normalizeBdMsisdn } from '../../src/utils/phone';
import { toBn } from '../../src/utils/bangla';

type ErrKey = keyof typeof bn.auth.errors;

/** Sign-up step 2: phone number, with the OTP opt-in disclosed directly above the button. */
export default function Phone() {
  const t = useT();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const send = async () => {
    const msisdn = normalizeBdMsisdn(value);
    if (!msisdn) {
      setError(t('auth.phone.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setCode(null);
    try {
      const r = await api.auth.requestOtp(msisdn);
      router.push({
        pathname: '/(auth)/otp',
        params: {
          msisdn,
          masked: r.maskedPhone,
          expiresAt: String(Date.now() + r.expiresInSeconds * 1000),
        },
      });
    } catch (e) {
      // Plain Bangla, never a raw error code (design.md 6.11).
      const c = e instanceof ApiError ? e.code : 'SERVICE_TROUBLE';
      const key: ErrKey = c in bn.auth.errors ? (c as ErrKey) : 'SERVICE_TROUBLE';
      setCode(c);
      setError(t(`auth.errors.${key}`));
      if (c === 'NUMBER_BLOCKED') setBlocked(true); // no retry button for a blocked number
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title={t('auth.phone.title')} tone="plain" />
      <Screen edges={['bottom']} contentStyle={{ gap: 18 }}>
        <TextField
          label={t('auth.phone.label')}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(null);
            setBlocked(false);
          }}
          keyboardType="phone-pad"
          placeholder={t('auth.phone.placeholder')}
          maxLength={18}
          autoFocus
          error={error}
          style={{ fontSize: 22, letterSpacing: 1 }}
        />

        {code === 'NOT_ON_TEST_LIST' ? (
          <Card tone="amber">
            <Text variant="titleMedium">{t('auth.phone.support')}</Text>
            <Text
              variant="bodyLarge"
              onPress={() => void Linking.openURL(`mailto:${t('legal.supportEmail')}`)}
              style={{ color: colors.primary }}
            >
              {t('legal.supportEmail')}
            </Text>
            <Text
              variant="bodyLarge"
              onPress={() =>
                void Linking.openURL(`tel:${t('legal.supportPhone').replace(/[^\d]/g, '')}`)
              }
              style={{ color: colors.primary }}
            >
              {t('legal.supportPhone')}
            </Text>
          </Card>
        ) : null}

        {/* The opt-in disclosure sits directly above the button. */}
        <View
          style={{
            flexDirection: 'row',
            gap: 10,
            backgroundColor: colors.mintTint,
            padding: 14,
            borderRadius: 14,
            alignItems: 'flex-start',
          }}
        >
          <Icon name="shield-check-outline" size={24} color="primary" />
          <Text variant="bodyLarge" color="onSurface" style={{ flex: 1 }}>
            {t('auth.phone.disclosure')}
          </Text>
        </View>

        {!blocked ? (
          <Button
            label={t('auth.phone.send')}
            loading={busy}
            disabled={value.length < 4}
            onPress={send}
          />
        ) : null}
        <Text variant="caption" style={{ textAlign: 'center' }}>
          {toBn('01XXXXXXXXX')}
        </Text>
      </Screen>
    </>
  );
}
