import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ApiError } from '../../src/api/client';
import { api } from '../../src/api/endpoints';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { useT } from '../../src/i18n';
import { useSession } from '../../src/store/session';
import { toBn, toLatinDigits, pad2 } from '../../src/utils/bangla';

/** Sign-up step 3: 6-digit code, visible 5-minute countdown, resend only after the countdown. */
export default function Otp() {
  const t = useT();
  const { msisdn, masked, expiresAt } = useLocalSearchParams<{
    msisdn: string;
    masked?: string;
    expiresAt?: string;
  }>();
  const [deadline, setDeadline] = useState(Number(expiresAt) || Date.now() + 300000);
  const [left, setLeft] = useState(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accountType = useSession((s) => s.pendingAccountType);
  const setSession = useSession((s) => s.setSession);

  useEffect(() => {
    const id = setInterval(
      () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(id);
  }, [deadline]);

  const verify = async () => {
    if (!msisdn) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.verifyOtp(msisdn, toLatinDigits(otp), accountType ?? undefined);
      await setSession({ token: r.token, refreshToken: r.refreshToken, user: r.user });
      // The first-run permissions and battery steps follow; index.tsx routes there.
      router.replace('/');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'SERVICE_TROUBLE';
      if (code === 'OTP_WRONG') {
        setError(t('auth.otp.wrong'));
        setOtp('');
      } else if (code === 'OTP_EXPIRED') {
        setError(t('auth.otp.expired'));
        setLeft(0);
      } else {
        setError(t('common.noConnection'));
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!msisdn) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.requestOtp(msisdn);
      const d = Date.now() + r.expiresInSeconds * 1000;
      setDeadline(d);
      setLeft(r.expiresInSeconds);
      setOtp('');
    } catch {
      setError(t('common.noConnection'));
    } finally {
      setBusy(false);
    }
  };

  const mm = Math.floor(left / 60);
  const ss = left % 60;

  return (
    <>
      <Header title={t('auth.otp.title')} tone="plain" />
      <Screen edges={['bottom']} contentStyle={{ gap: 18 }}>
        <Text variant="bodyLarge">
          {t('auth.otp.sentTo')}: {toBn(masked ?? '')}
        </Text>
        <TextField
          label={t('auth.otp.label')}
          value={otp}
          onChangeText={(v) => {
            setOtp(toLatinDigits(v).replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          error={error}
          style={{ fontSize: 30, textAlign: 'center', letterSpacing: 10 }}
        />
        <Text
          variant="titleMedium"
          style={{ textAlign: 'center' }}
          accessibilityLiveRegion="polite"
        >
          {t('auth.otp.countdown')}: {toBn(`${pad2(mm)}:${pad2(ss)}`)}
        </Text>
        <Button
          label={t('auth.otp.verify')}
          loading={busy}
          disabled={otp.length !== 6 || left === 0}
          onPress={verify}
        />
        {left === 0 ? (
          <Button
            label={t('auth.otp.resend')}
            variant="secondary"
            loading={busy}
            onPress={resend}
          />
        ) : null}
      </Screen>
    </>
  );
}
