import { ComingSoon } from '../src/components/ComingSoon';
import { useT } from '../src/i18n';

// Day 7: symptom journaling and the 999 red-flag modal.
export default function Symptoms() {
  const t = useT();
  return <ComingSoon title={t('symptoms.title')} />;
}
