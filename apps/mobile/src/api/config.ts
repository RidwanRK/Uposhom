import Constants from 'expo-constants';

interface Extra {
  apiUrl?: string;
  useMock?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Our own backend. The app never talks to Applink and holds no Applink secret. */
export const API_URL = (extra.apiUrl ?? '').replace(/\/$/, '');

/**
 * Mock mode serves seeded synthetic data from inside the app, so the whole UI runs before the live
 * endpoints land (Master Plan section 18: "D builds against the shared contracts and the mock API").
 * It is on unless EXPO_PUBLIC_USE_MOCK=0, or an API URL is set and mock was not asked for.
 */
export const USE_MOCK = extra.useMock === '1' || (extra.useMock !== '0' && API_URL === '');
