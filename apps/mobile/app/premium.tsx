import { router } from 'expo-router';
import { Header } from '../src/components/Header';
import { PremiumView } from '../src/components/PremiumView';
import { Screen } from '../src/components/Screen';
import { useT } from '../src/i18n';

export default function Premium() {
  const t = useT();
  return (
    <>
      <Header
        title={t('premium.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Screen edges={['bottom']}>
        <PremiumView />
      </Screen>
    </>
  );
}
