import { ComingSoon } from '../src/components/ComingSoon';
import { useT } from '../src/i18n';

// Day 4: alerts inbox with caregiver acknowledge.
export default function Alerts() {
  const t = useT();
  return <ComingSoon title={t('alerts.title')} />;
}
