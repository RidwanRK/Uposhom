import { ComingSoon } from '../src/components/ComingSoon';
import { useT } from '../src/i18n';

// Day 7: voice schedule query.
export default function Voice() {
  const t = useT();
  return <ComingSoon title={t('voice.title')} />;
}
