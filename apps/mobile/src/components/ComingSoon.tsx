import { Header } from './Header';
import { EmptyState } from './Misc';
import { Screen } from './Screen';
import { useT } from '../i18n';

/** Route placeholder for screens that belong to a later day of the plan (Day 2 onward). */
export function ComingSoon({ title, noBack }: { title: string; noBack?: boolean }) {
  const t = useT();
  return (
    <>
      <Header title={title} noBack={noBack} />
      <Screen edges={['bottom']}>
        <EmptyState icon="hammer-wrench" title={t('common.comingSoon')} />
      </Screen>
    </>
  );
}
