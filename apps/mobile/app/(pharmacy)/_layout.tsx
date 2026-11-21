import { Tabs } from 'expo-router';
import { TabBar } from '../../src/components/TabBar';
import { useT } from '../../src/i18n';

/** Pharmacy account: its own 3-tab bar (Stock, Subscription, Store profile). Screens land on Day 7. */
export default function PharmacyLayout() {
  const t = useT();
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, animation: 'fade' }}
    >
      <Tabs.Screen
        name="stock"
        options={{
          title: t('pharmacy.tabs.stock'),
          ...({ tabBarIconName: 'package-variant-closed' } as object),
        }}
      />
      <Tabs.Screen
        name="subscription"
        options={{
          title: t('pharmacy.tabs.subscription'),
          ...({ tabBarIconName: 'star-circle-outline' } as object),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('pharmacy.tabs.profile'),
          ...({ tabBarIconName: 'store-outline' } as object),
        }}
      />
    </Tabs>
  );
}
