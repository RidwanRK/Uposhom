import * as Speech from 'expo-speech';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../src/api/client';
import { api } from '../src/api/endpoints';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { Header } from '../src/components/Header';
import { MicOrb } from '../src/components/MicOrb';
import { Banner } from '../src/components/Misc';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { TextField } from '../src/components/TextField';
import { useActiveProfile } from '../src/hooks/queries';
import { useVoiceRecorder } from '../src/hooks/useVoiceRecorder';
import { useT } from '../src/i18n';
import { errorMessage } from '../src/utils/errors';
import { answerScheduleQuestion } from '../src/utils/scheduleAnswer';
import { openAppSettings } from '../src/utils/permissions';

type Phase = 'idle' | 'recording' | 'transcribing' | 'ask' | 'asking' | 'answer';

/**
 * Screen 9: voice schedule query. Record, then show the editable transcript, then show the answer.
 * Nothing is acted on before the person sees the transcript. A voice query is read-only: it never marks a
 * dose or changes a schedule. The answer is read aloud with Android text-to-speech.
 */
export default function Voice() {
  const t = useT();
  const { profile } = useActiveProfile();
  const { recording, start, stop } = useVoiceRecorder();
  const [phase, setPhase] = useState<Phase>('idle');
  const [text, setText] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [micBlocked, setMicBlocked] = useState(false);

  useEffect(() => () => void Speech.stop(), []);

  const speak = (s: string) => {
    try {
      void Speech.stop();
      Speech.speak(s, { language: 'bn-BD', rate: 0.9 });
    } catch {
      // text-to-speech is best effort; the answer is also shown on screen
    }
  };

  const toggleMic = async () => {
    setError(null);
    if (!recording) {
      const r = await start();
      setMicBlocked(r === 'blocked');
      if (r === 'ok') setPhase('recording');
      else
        setError(
          r === 'blocked'
            ? t('symptoms.micBlocked')
            : r === 'denied'
              ? t('symptoms.micDenied')
              : t('common.errorGeneric'),
        );
      return;
    }
    setPhase('transcribing');
    const file = await stop();
    if (!file) {
      setPhase('ask');
      return setError(t('common.errorGeneric'));
    }
    try {
      const r = await api.voice.transcribe(file);
      setText(r.transcript);
    } catch (e) {
      setError(errorMessage(e, t));
    }
    setPhase('ask');
  };

  const ask = async (q: string) => {
    if (!q.trim() || !profile) return;
    setPhase('asking');
    setError(null);
    try {
      let reply: string;
      try {
        reply = (await api.voice.query(profile.id, q.trim())).answerText;
      } catch (e) {
        // The triage endpoint is not served yet: answer from the schedule the server already gave us.
        if (e instanceof ApiError && !e.isNetwork && (e.status === 404 || e.status >= 500)) {
          const today = await api.doses.today(profile.id, 1);
          reply = answerScheduleQuestion(today.doses, q);
        } else throw e;
      }
      setAnswer(reply);
      setPhase('answer');
      speak(reply);
    } catch (e) {
      setError(errorMessage(e, t));
      setPhase('ask');
    }
  };

  const reset = () => {
    void Speech.stop();
    setText('');
    setAnswer('');
    setError(null);
    setPhase('idle');
  };

  const showInput = phase === 'idle' || phase === 'ask';

  return (
    <>
      <Header title={t('voice.title')} />
      <Screen edges={['bottom']}>
        <Text variant="headlineSmall" style={{ textAlign: 'center' }}>
          {t('voice.prompt')}
        </Text>

        <MicOrb
          active={recording}
          busy={phase === 'transcribing' || phase === 'asking'}
          onPress={toggleMic}
          label={recording ? t('symptoms.tapToStop') : t('symptoms.tapToSpeak')}
        />
        <Text variant="bodyLarge" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
          {phase === 'recording'
            ? t('symptoms.listening')
            : phase === 'transcribing'
              ? t('symptoms.transcribing')
              : phase === 'asking'
                ? t('common.loading')
                : ''}
        </Text>

        {error ? <Banner icon="alert-circle-outline" text={error} /> : null}
        {micBlocked ? (
          <Button
            label={t('common.openSettings')}
            icon="cog-outline"
            variant="secondary"
            onPress={() => void openAppSettings()}
          />
        ) : null}

        {showInput ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chip label={t('voice.chipNext')} onPress={() => void ask(t('voice.chipNext'))} />
              <Chip label={t('voice.chipLeft')} onPress={() => void ask(t('voice.chipLeft'))} />
            </View>
            <TextField
              label={t('symptoms.transcriptLabel')}
              value={text}
              onChangeText={setText}
              placeholder={t('symptoms.textPlaceholder')}
            />
            <Button label={t('voice.ask')} disabled={!text.trim()} onPress={() => void ask(text)} />
          </View>
        ) : null}

        {phase === 'answer' ? (
          <View style={{ gap: 12 }}>
            <Text variant="caption">{t('voice.readOnly')}</Text>
            <Card tone="mint" style={{ gap: 8 }} accessibilityLiveRegion="polite">
              <Text variant="titleMedium" color="primary">
                {t('voice.answer')}
              </Text>
              <Text variant="headlineSmall" color="onSurface">
                {answer}
              </Text>
            </Card>
            <Button
              label={t('voice.replay')}
              icon="volume-high"
              variant="secondary"
              onPress={() => speak(answer)}
            />
            <Button label={t('voice.askAgain')} variant="ghost" onPress={reset} />
          </View>
        ) : null}
      </Screen>
    </>
  );
}
