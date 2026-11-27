import { useEffect, useState } from 'react';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import { toLatinDigits } from '../utils/bangla';
import { errorMessage } from '../utils/errors';
import { OTP_LENGTH, cleanOtp, isOtpComplete } from '../utils/otp';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

/**
 * Premium subscription by OTP (Applink OTP API). Step 1 records the consent the person ticked and
 * has Applink text a code to their number; step 2 sends the code back, and a successful check
 * activates the subscription. Premium itself only shows once the server's own record says ACTIVE.
 */
export function SubscribeOtpSheet({
  visible,
  consentWording,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** The exact wording on screen, stored as the consent evidence. */
  consentWording: string;
  onClose: () => void;
  /** The code was accepted: the caller refreshes the subscription status. */
  onDone: () => void;
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
      await api.billing.requestSubscribeOtp(consentWording);
      setSent(true);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.billing.verifySubscribeOtp(toLatinDigits(otp));
      onDone();
    } catch (e) {
      setError(errorMessage(e, t));
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('premium.otpTitle')}>
      <Text variant="bodyLarge">{t('premium.otpBody')}</Text>
      {!sent ? (
        <Button label={t('premium.otpSend')} loading={busy} onPress={send} />
      ) : (
        <>
          <TextField
            value={otp}
            onChangeText={(v) => setOtp(cleanOtp(v))}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            autoFocus
            error={error}
            accessibilityLabel={t('auth.otp.label')}
            style={{ fontSize: 28, textAlign: 'center', letterSpacing: 8 }}
          />
          <Button
            label={t('premium.otpVerify')}
            loading={busy}
            disabled={!isOtpComplete(otp)}
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
