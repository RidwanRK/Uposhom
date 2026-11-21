import { router } from 'expo-router';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { useT } from '../../src/i18n';

// Store profile lands on Day 7. Settings (sign out) is reachable from here meanwhile.
export default function StoreProfile() {
  const t = useT();
  return (
    <>
      <Header title={t('pharmacy.profileTitle')} noBack />
      <Screen edges={['bottom']}>
        <Button
          label={t('settings.title')}
          icon="cog-outline"
          variant="secondary"
          onPress={() => router.push('/settings')}
        />
      </Screen>
    </>
  );
}
