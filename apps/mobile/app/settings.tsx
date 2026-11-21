import { router } from 'expo-router';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { Switch56 } from '../src/components/Switch56';
import { api } from '../src/api/endpoints';
import { cache } from '../src/db/cache';
import { useT } from '../src/i18n';
import { useSession } from '../src/store/session';
import { useSettings } from '../src/store/settings';

/** Day 0 slice of Settings: larger text and sign out. The rest lands on Day 4. */
export default function Settings() {
  const t = useT();
  const largeText = useSettings((s) => s.largeText);
  const setLargeText = useSettings((s) => s.setLargeText);
  const clear = useSession((s) => s.clear);

  const signOut = async () => {
    try {
      await api.auth.logout();
    } catch {
      // sign out locally even if the server cannot be reached
    }
    await cache.clear();
    await clear();
    router.replace('/(auth)/account-type');
  };

  return (
    <>
      <Header title={t('settings.title')} />
      <Screen edges={['bottom']}>
        <Switch56 value={largeText} onValueChange={setLargeText} label={t('settings.largeText')} />
        <Button
          label={t('settings.fixBattery')}
          variant="secondary"
          icon="battery-heart-outline"
          onPress={() => router.push('/battery-setup')}
        />
        <Button label={t('settings.signOut')} variant="danger" icon="logout" onPress={signOut} />
      </Screen>
    </>
  );
}
