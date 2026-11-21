import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import { toLatinDigits } from '../utils/bangla';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

/**
 * Step-up code before a sensitive action (remove a person, delete my data). Sends a code to the
 * signed-in number, verifies it, and hands back a short-lived step-up token.
 */
export function StepUpSheet({
  visible,
  onClose,
  onToken,
}: {
  visible: boolean;
  onClose: () => void;
  onToken: (token: string) => void;
}) {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSent(false);
      setOtp('');
      setError(null);
    }
  }, [visible]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.auth.requestStepUp();
      setSent(true);
    } catch {
      setError(t('common.noConnection'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.auth.verifyStepUp(toLatinDigits(otp));
      onToken(r.stepUpToken);
    } catch {
      setError(t('auth.otp.wrong'));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('profile.stepUpTitle')}>
      <Text variant="bodyLarge">{t('profile.stepUpBody')}</Text>
      {!sent ? (
        <Button label={t('profile.stepUpSend')} loading={busy} onPress={send} />
      ) : (
        <>
          <TextField
            value={otp}
            onChangeText={(v) => setOtp(toLatinDigits(v).replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            error={error}
            accessibilityLabel={t('auth.otp.label')}
            style={{ fontSize: 28, textAlign: 'center', letterSpacing: 8 }}
          />
          <Button
            label={t('profile.stepUpVerify')}
            loading={busy}
            disabled={otp.length !== 6}
            onPress={verify}
          />
        </>
      )}
      {!sent && error ? (
        <Text variant="bodyMedium" style={{ color: '#C62828' }}>
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
