import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import type { DoctorSummary } from '@uposhom/shared';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Header } from '../src/components/Header';
import { Banner, Disclaimer, EmptyState, Loading } from '../src/components/Misc';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useActiveProfile } from '../src/hooks/queries';
import { usePaymentGate } from '../src/hooks/usePaymentGate';
import { useT } from '../src/i18n';
import { formatDateBn } from '../src/utils/dates';
import { errorMessage } from '../src/utils/errors';
import { summaryHtml, type SummaryLabels } from '../src/utils/summaryPdf';

/**
 * Screen 16: Doctor summary. A structured card with a "not a diagnosis" footer, then view the PDF or share
 * it through the Android share sheet. Premium accounts generate it freely; Free accounts see the
 * pay-per-use sheet first (the server answers 402 PAYMENT_REQUIRED for DOCTOR_SUMMARY).
 */
export default function DoctorSummaryScreen() {
  const t = useT();
  const gate = usePaymentGate();
  const { profile } = useActiveProfile();
  const { summaryId } = useLocalSearchParams<{ summaryId?: string }>();
  const [summary, setSummary] = useState<DoctorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfBusy, setPdfBusy] = useState<'view' | 'share' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setMessage(null);
    try {
      const fetchIt = () => api.summaries.doctor(profile.id, summaryId);
      let res;
      try {
        res = await fetchIt();
      } catch (e) {
        // Free tier: pay per use (৳৫), then ask again.
        if (gate.paymentPurpose(e) && (await gate.requestPayment('DOCTOR_SUMMARY')))
          res = await fetchIt();
        else throw e;
      }
      setSummary(res.summary);
    } catch (e) {
      setMessage(errorMessage(e, t));
    } finally {
      setLoading(false);
    }
  }, [profile, summaryId, gate, t]);

  useEffect(() => {
    void load();
  }, [profile?.id, summaryId]);

  const labels: SummaryLabels = {
    title: t('doctorSummary.title'),
    symptoms: t('doctorSummary.symptoms'),
    onset: t('doctorSummary.onset'),
    duration: t('doctorSummary.duration'),
    severity: t('doctorSummary.severity'),
    triggers: t('doctorSummary.triggers'),
    associated: t('doctorSummary.associated'),
    medicines: t('doctorSummary.medicines'),
    recent: t('doctorSummary.recent'),
    disclaimer: t('doctorSummary.disclaimer'),
  };

  const html = () =>
    summary && profile ? summaryHtml(summary, profile.name, formatDateBn(Date.now()), labels) : '';

  const view = async () => {
    setPdfBusy('view');
    try {
      await Print.printAsync({ html: html() });
    } catch {
      setMessage(t('common.errorGeneric'));
    } finally {
      setPdfBusy(null);
    }
  };

  const share = async () => {
    setPdfBusy('share');
    try {
      const { uri } = await Print.printToFileAsync({ html: html() });
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('doctorSummary.title'),
        });
      else setMessage(t('doctorSummary.notAvailable'));
    } catch {
      setMessage(t('common.errorGeneric'));
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <>
      <Header title={t('doctorSummary.title')} />
      <Screen edges={['bottom']}>
        {loading ? <Loading label={t('doctorSummary.generating')} /> : null}
        {message ? <Banner icon="alert-circle-outline" text={message} /> : null}
        {!loading && !summary && !message ? (
          <EmptyState icon="file-document-outline" title={t('doctorSummary.none')} />
        ) : null}
        {summary ? (
          <>
            <Card style={{ gap: 8 }}>
              <Field label={t('doctorSummary.symptoms')} value={summary.symptoms} />
              <Field label={t('doctorSummary.onset')} value={summary.onset} />
              <Field label={t('doctorSummary.duration')} value={summary.duration} />
              <Field label={t('doctorSummary.severity')} value={summary.severity} />
              <Field label={t('doctorSummary.triggers')} value={summary.triggers} />
              <Field label={t('doctorSummary.associated')} value={summary.associated} />
              <Field
                label={t('doctorSummary.medicines')}
                value={summary.currentMedicines.join(', ')}
              />
              <Field
                label={t('doctorSummary.recent')}
                value={summary.recentPrescriptions.join(', ')}
              />
            </Card>
            <Disclaimer text={t('doctorSummary.disclaimer')} />
            <Button
              label={t('doctorSummary.view')}
              icon="file-pdf-box"
              loading={pdfBusy === 'view'}
              onPress={view}
            />
            <Button
              label={t('doctorSummary.share')}
              icon="share-variant"
              variant="secondary"
              loading={pdfBusy === 'share'}
              onPress={share}
            />
          </>
        ) : null}
      </Screen>
    </>
  );
}

function Field({ label, value }: { label: string; value?: string | undefined }) {
  if (!value) return null;
  return (
    <View>
      <Text variant="caption">{label}</Text>
      <Text variant="bodyLarge" color="onSurface">
        {value}
      </Text>
    </View>
  );
}
