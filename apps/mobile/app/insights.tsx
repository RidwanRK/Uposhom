import { Header } from '../src/components/Header';
import { HistoryView } from '../src/components/HistoryView';
import { Screen } from '../src/components/Screen';
import { useActiveProfile } from '../src/hooks/queries';
import { useT } from '../src/i18n';

/** Screen 8 as its own route (it is also the third segment of the Health Vault tab). */
export default function Insights() {
  const t = useT();
  const { profile } = useActiveProfile();
  return (
    <>
      <Header title={t('insights.title')} />
      <Screen edges={['bottom']}>
        <HistoryView profileId={profile?.id} />
      </Screen>
    </>
  );
}
