import { ComingSoon } from '../src/components/ComingSoon';
import { useT } from '../src/i18n';

// Day 4: Premium upgrade and consent screen.
export default function Premium() {
  const t = useT();
  return <ComingSoon title={t('premium.title')} />;
}
