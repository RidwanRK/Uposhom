import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { DoctorSummary } from '@uposhom/shared';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmergencyModal } from '../src/components/EmergencyModal';
import { Header } from '../src/components/Header';
import { MicOrb } from '../src/components/MicOrb';
import { Banner, Disclaimer } from '../src/components/Misc';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { TextField } from '../src/components/TextField';
import { useActiveProfile } from '../src/hooks/queries';
import { useVoiceRecorder } from '../src/hooks/useVoiceRecorder';
import { useT } from '../src/i18n';
import { toBn } from '../src/utils/bangla';
import { errorMessage } from '../src/utils/errors';
import { checkRedFlag, EMERGENCY_MESSAGE } from '../src/utils/redflag';

type Phase = 'describe' | 'question' | 'summary';

/**
 * Screen 7: voice symptom journaling and the 999 emergency modal.
 *  - Record-then-transcribe: the transcript appears in an editable box and nothing is saved before the
 *    person has seen it. A text box is always there instead of voice.
 *  - Up to six short Bangla follow-up questions, one at a time, each answered by voice or text and skippable.
 *  - The red-flag check is a deterministic keyword match that runs on the phone before anything is sent,
 *    and the server runs the same guard before any AI call.
 */
export default function Symptoms() {
  const t = useT();
  const { profile } = useActiveProfile();
  const { recording, start, stop } = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>('describe');
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [question, setQuestion] = useState<{ text: string; n: number; total: number } | null>(null);
  const [summary, setSummary] = useState<DoctorSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emergency, setEmergency] = useState<{ message?: string; dial?: string } | null>(null);

  const toggleMic = async () => {
    setError(null);
    if (!recording) {
      const r = await start();
      if (r !== 'ok') setError(r === 'denied' ? t('symptoms.micDenied') : t('common.errorGeneric'));
      return;
    }
    setTranscribing(true);
    const file = await stop();
    try {
      if (file) {
        const r = await api.voice.transcribe(file);
        setText((prev) => (prev ? `${prev} ${r.transcript}` : r.transcript));
        setChannel('VOICE');
      }
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setTranscribing(false);
    }
  };

  const submit = async (opts: { skip?: boolean } = {}) => {
    if (!profile) return;
    const input = text.trim();
    if (!opts.skip && !input) return setError(t('symptoms.emptyInput'));

    // Deterministic red-flag guard first, on the phone, before anything is sent.
    if (!opts.skip && checkRedFlag(input).isRedFlag) {
      setEmergency({ message: EMERGENCY_MESSAGE, dial: 'tel:999' });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const r = await api.symptoms.journal({
        profileId: profile.id,
        inputText: input,
        channel,
        sessionId,
        skip: opts.skip,
      });
      if (r.isRedFlag) {
        setEmergency({ message: r.alertMessage, dial: r.emergencyDial });
        return;
      }
      setSessionId(r.sessionId ?? sessionId);
      setText('');
      if (r.nextQuestion) {
        setQuestion({ text: r.nextQuestion, n: r.questionIndex ?? 1, total: r.questionTotal ?? 6 });
        setPhase('question');
      } else if (r.summary) {
        setSummary(r.summary);
        setPhase('summary');
      }
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setPhase('describe');
    setText('');
    setSessionId(undefined);
    setQuestion(null);
    setSummary(null);
    setChannel('TEXT');
  };

  return (
    <>
      <Header title={t('symptoms.title')} />
      <Screen edges={['bottom']}>
        {phase === 'describe' ? (
          <>
            <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
              {t('symptoms.prompt')}
            </Text>
            <MicOrb
              active={recording}
              busy={transcribing}
              onPress={toggleMic}
              label={recording ? t('symptoms.tapToStop') : t('symptoms.tapToSpeak')}
            />
            <Text
              variant="bodyLarge"
              style={{ textAlign: 'center' }}
              accessibilityLiveRegion="polite"
            >
              {recording ? t('symptoms.listening') : transcribing ? t('symptoms.transcribing') : ''}
            </Text>
          </>
        ) : null}

        {phase === 'question' && question ? (
          <Card tone="mint" style={{ gap: 8 }}>
            <Text variant="caption">
              {t('symptoms.questionOf', { n: toBn(question.n), total: toBn(question.total) })}
            </Text>
            <Text variant="headlineSmall" color="onSurface" accessibilityLiveRegion="polite">
              {question.text}
            </Text>
          </Card>
        ) : null}

        {error ? <Banner icon="alert-circle-outline" text={error} /> : null}

        {phase !== 'summary' ? (
          <View style={{ gap: 12 }}>
            {phase === 'question' ? (
              <MicOrb
                active={recording}
                busy={transcribing}
                onPress={toggleMic}
                label={recording ? t('symptoms.tapToStop') : t('symptoms.tapToSpeak')}
              />
            ) : null}
            <TextField
              label={
                phase === 'describe'
                  ? t('symptoms.transcriptLabel')
                  : t('symptoms.answerPlaceholder')
              }
              value={text}
              onChangeText={(v) => {
                setText(v);
                setError(null);
              }}
              placeholder={t('symptoms.textPlaceholder')}
              multiline
            />
            <Button
              label={t('symptoms.send')}
              loading={busy}
              disabled={!text.trim()}
              onPress={() => void submit()}
            />
            {phase === 'question' ? (
              <Button
                label={t('symptoms.skip')}
                variant="ghost"
                onPress={() => void submit({ skip: true })}
              />
            ) : null}
          </View>
        ) : null}

        {phase === 'summary' && summary ? (
          <View style={{ gap: 12 }}>
            <Text variant="headlineSmall">{t('symptoms.summaryTitle')}</Text>
            <Card style={{ gap: 6 }}>
              <Line label={t('doctorSummary.symptoms')} value={summary.symptoms} />
              <Line label={t('doctorSummary.onset')} value={summary.onset} />
              <Line label={t('doctorSummary.duration')} value={summary.duration} />
              <Line label={t('doctorSummary.severity')} value={summary.severity} />
              <Line label={t('doctorSummary.triggers')} value={summary.triggers} />
              <Line label={t('doctorSummary.associated')} value={summary.associated} />
              <Line
                label={t('doctorSummary.medicines')}
                value={summary.currentMedicines.join(', ')}
              />
            </Card>
            <Disclaimer text={t('symptoms.disclaimer')} />
            <Button
              label={t('symptoms.doctorButton')}
              icon="file-document-outline"
              onPress={() =>
                router.push({
                  pathname: '/doctor-summary',
                  params: summary.id ? { summaryId: summary.id } : {},
                })
              }
            />
            <Button label={t('symptoms.newEntry')} variant="ghost" onPress={restart} />
          </View>
        ) : null}
      </Screen>

      <EmergencyModal
        visible={!!emergency}
        message={emergency?.message}
        dial={emergency?.dial}
        onDismiss={() => setEmergency(null)}
      />
    </>
  );
}

function Line({ label, value }: { label: string; value?: string | undefined }) {
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
