import { Redirect } from 'expo-router';
import { useSession } from '../src/store/session';

/** Decides where a launch lands: sign-up, first-run setup, the family tabs or the pharmacy tabs. */
export default function Index() {
  const { hydrated, accessToken, user, onboarded } = useSession();
  if (!hydrated) return null;
  if (!accessToken || !user) return <Redirect href="/(auth)/account-type" />;
  if (!onboarded) return <Redirect href="/(auth)/permissions" />;
  if (user.role === 'PHARMACY_OWNER') return <Redirect href="/(pharmacy)/stock" />;
  return <Redirect href="/(tabs)" />;
}
