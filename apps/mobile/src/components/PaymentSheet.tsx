import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { CaasPurpose } from '@uposhom/shared';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { toLatinDigits } from '../utils/bangla';
import { errorMessage } from '../utils/errors';
import { qk } from '../hooks/queries';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';
import { TextField } from './TextField';
import { PAYMENT_OTP_MAX, cleanPaymentOtp, isPaymentOtpComplete } from '../utils/otp';

type Step = 'price' | 'code' | 'processing' | 'success' | 'noBalance' | 'failed' | 'slow';

/**
 * Pay-per-use bottom sheet (design.md Screen 12). Two-step CaaS flow:
 *  1. price + consent. The button is the user's explicit consent and sends the payment code by SMS.
 *  2. payment code. A wrong code retries on the same request. "Code did not arrive" only appears after
 *     the code expired and starts a brand new payment.
 *  3. result. Nothing is granted until the carrier confirms: we poll the charge status.
 */
export function PaymentSheet({
  purpose,
  onDone,
}: {
  purpose: CaasPurpose | null;
  onDone: (ok: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('price');
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    setStep('price');
    setChargeId(null);
    setOtp('');
    setError(null);
    setBusy(false);
    setExpired(false);
  };

  useEffect(() => {
    if (purpose) reset();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (expiry.current) clearTimeout(expiry.current);
    };
  }, [purpose]);

  const start = async () => {
    if (!purpose) return;
    setBusy(true);
    setError(null);
    try {
      // The exact wording shown on screen is stored as consent evidence.
      const r = await api.billing.caasInitiate(purpose, t(`pay.prices.${purpose}`));
      setChargeId(r.chargeId);
      setStep('code');
      setExpired(false);
      if (expiry.current) clearTimeout(expiry.current);
      expiry.current = setTimeout(() => setExpired(true), 5 * 60 * 1000);
    } catch (e) {
      // Say why (not registered, too many tries, no balance, service down), never a bare "failed".
      setError(errorMessage(e, t, 'PAYMENT_UNAVAILABLE'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * The carrier settles the charge with a notification that can take a while. Poll for about two
   * minutes; if it is still pending then, do not call it failed (money may already be taken): say
   * so, and the credit applies when the notification lands.
   */
  const POLL_TRIES = 80;
  const poll = (id: string, tries = 0) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await api.billing.caasStatus(id);
        if (r.status === 'SETTLED') {
          setStep('success');
          void qc.invalidateQueries({ queryKey: qk.entitlements });
          setTimeout(() => onDone(true), 900);
        } else if (r.status === 'INSUFFICIENT_BALANCE') setStep('noBalance');
        else if (r.status === 'FAILED' || r.status === 'EXPIRED') setStep('failed');
        else if (tries > POLL_TRIES) setStep('slow');
        else poll(id, tries + 1);
      } catch {
        if (tries > POLL_TRIES) setStep('slow');
        else poll(id, tries + 1);
      }
    }, 1500);
  };

  const verify = async () => {
    if (!chargeId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.billing.caasVerify(chargeId, toLatinDigits(otp.trim()));
      if (r.code === 'OTP_WRONG') {
        setError(t('pay.wrong'));
        setOtp('');
      } else if (r.status === 'INSUFFICIENT_BALANCE') {
        setStep('noBalance');
      } else if (r.status === 'FAILED' || r.status === 'EXPIRED') {
        setStep('failed');
      } else {
        // PENDING: the carrier has not confirmed yet. Grant nothing until it does.
        setStep('processing');
        poll(chargeId);
      }
    } catch (e) {
      setError(errorMessage(e, t, 'PAYMENT_UNAVAILABLE'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => onDone(step === 'success');
  const locked = step === 'processing';

  return (
    <BottomSheet
      visible={purpose !== null}
      onClose={close}
      title={t('pay.title')}
      dismissable={!locked}
    >
      {purpose ? (
        <Text variant="bodyLarge" color="onSurfaceVariant">
          {t(`pay.purposes.${purpose}`)}
        </Text>
      ) : null}

      {step === 'price' ? (
        <>
          <View style={{ backgroundColor: colors.mintTint, padding: 16, borderRadius: 12 }}>
            <Text variant="headlineSmall">{purpose ? t(`pay.prices.${purpose}`) : null}</Text>
          </View>
          {error ? (
            <Text variant="bodyMedium" style={{ color: colors.emergency }}>
              {error}
            </Text>
          ) : null}
          <Button label={t('pay.send')} loading={busy} onPress={start} />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </>
      ) : null}

      {step === 'code' ? (
        <>
          <TextField
            label={t('pay.codeLabel')}
            value={otp}
            onChangeText={(v) => setOtp(cleanPaymentOtp(v))}
            keyboardType="number-pad"
            maxLength={PAYMENT_OTP_MAX}
            error={error}
            autoFocus
            style={{ textAlign: 'center', letterSpacing: 6 }}
          />
          <Button
            label={t('pay.pay')}
            loading={busy}
            disabled={!isPaymentOtpComplete(otp)}
            onPress={verify}
          />
          {expired ? (
            <Button
              label={t('pay.noCode')}
              variant="secondary"
              onPress={() => {
                reset();
              }}
            />
          ) : null}
        </>
      ) : null}

      {step === 'processing' ? (
        <Result icon="timer-sand" tone="primary" text={t('pay.processing')} />
      ) : null}
      {step === 'success' ? (
        <Result icon="check-circle" tone="taken" text={t('pay.success')} />
      ) : null}
      {step === 'noBalance' ? (
        <>
          <Result icon="wallet-outline" tone="tertiary" text={t('pay.noBalance')} />
          <Button label={t('common.close')} variant="secondary" onPress={close} />
        </>
      ) : null}
      {step === 'slow' ? (
        <>
          <Result icon="timer-sand" tone="tertiary" text={t('pay.slow')} />
          <Button label={t('common.close')} variant="secondary" onPress={close} />
        </>
      ) : null}
      {step === 'failed' ? (
        <>
          <Result icon="alert-circle-outline" tone="tertiary" text={t('pay.failed')} />
          <Button label={t('common.retry')} onPress={reset} />
        </>
      ) : null}
    </BottomSheet>
  );
}

function Result({
  icon,
  tone,
  text,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  tone: 'primary' | 'taken' | 'tertiary';
  text: string;
}) {
  return (
    <View
      style={{ alignItems: 'center', gap: 10, paddingVertical: 12 }}
      accessibilityLiveRegion="polite"
    >
      <Icon name={icon} size={52} color={tone} />
      <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
        {text}
      </Text>
    </View>
  );
}
