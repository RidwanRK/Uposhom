import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';
import { TopBar } from '../../src/components/TopBar';
import { useT } from '../../src/i18n';

/** The 4-tab family navigation (design.md section 5): Home, Family, Vault, Explore. */
export default function TabsLayout() {
  const t = useT();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ header: () => <TopBar />, animation: 'fade' }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          ...({ tabBarIconName: 'home-variant-outline' } as object),
        }}
      />
      <Tabs.Screen
        name="family"
        options={{
          title: t('tabs.family'),
          ...({ tabBarIconName: 'account-group-outline' } as object),
        }}
      />
      <Tabs.Screen
        name="vault"
        options={{
          title: t('tabs.vault'),
          ...({ tabBarIconName: 'folder-heart-outline' } as object),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: t('tabs.explore'), ...({ tabBarIconName: 'pill' } as object) }}
      />
    </Tabs>
  );
}
