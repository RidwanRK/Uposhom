import { ComingSoon } from '../../src/components/ComingSoon';
import { useT } from '../../src/i18n';

export default function PharmacySubscription() {
  const t = useT();
  return <ComingSoon title={t('pharmacy.subTitle')} noBack />;
}
