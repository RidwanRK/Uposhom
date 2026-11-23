import * as Haptics from 'expo-haptics';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useState } from 'react';
import type { UploadFile } from '../api/client';

export type StartResult = 'ok' | 'denied' | 'error';

/**
 * Record-then-transcribe voice capture (design.md 6.7). The caller sends the file to
 * POST /voice/transcribe and shows the transcript in an editable box: nothing is acted on or saved
 * before the person has seen it. A text box is always available instead of voice.
 */
export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const start = useCallback(async (): Promise<StartResult> => {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return 'denied';
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      return 'ok';
    } catch {
      setRecording(false);
      return 'error';
    }
  }, [recorder]);

  const stop = useCallback(async (): Promise<UploadFile | null> => {
    try {
      await recorder.stop();
      setRecording(false);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      return uri ? { uri, name: 'voice.m4a', type: 'audio/mp4' } : null;
    } catch {
      setRecording(false);
      return null;
    }
  }, [recorder]);

  return { recording, start, stop };
}
