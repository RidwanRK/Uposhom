import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import { toLatinDigits } from '../utils/bangla';
import { errorMessage } from '../utils/errors';
import { OTP_LENGTH, cleanOtp, isOtpComplete } from '../utils/otp';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Text } from './Text';
import { TextField } from './TextField';

/** The server's codes last five minutes; a little less, so a reopened sheet never shows a dead code. */
const CODE_REUSE_MS = 4 * 60 * 1000;

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
  // When the last code went out. Reopening the sheet soon after must not send a second SMS: codes
  // are paid, rate limited, and Applink may refuse a second one while the first is still valid.
  const sentAt = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      setSent(sentAt.current !== null && Date.now() - sentAt.current < CODE_REUSE_MS);
      setOtp('');
      setError(null);
    }
  }, [visible]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.billing.requestSubscribeOtp(consentWording);
      sentAt.current = Date.now();
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
      sentAt.current = null; // the code is used up
      onDone();
    } catch (e) {
      // An expired code cannot be retried: offer to send a new one.
      if (e instanceof ApiError && e.code === 'OTP_EXPIRED') {
        sentAt.current = null;
        setSent(false);
      }
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
