import { ComingSoon } from '../../src/components/ComingSoon';
import { useT } from '../../src/i18n';

export default function Stock() {
  const t = useT();
  return <ComingSoon title={t('pharmacy.stockTitle')} noBack />;
}
