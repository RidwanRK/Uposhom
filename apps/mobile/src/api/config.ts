import Constants from 'expo-constants';

interface Extra {
  apiUrl?: string;
  useMock?: string;
  mockMissing?: string;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Our own backend. The app never talks to Applink and holds no Applink secret. */
export const API_URL = (extra.apiUrl ?? '').replace(/\/$/, '');

/**
 * Mock mode serves seeded synthetic data from inside the app, so the whole UI runs with no backend
 * (Master Plan section 18). It is on unless EXPO_PUBLIC_USE_MOCK=0, or an API URL is set and mock was
 * not asked for.
 */
export const USE_MOCK = extra.useMock === '1' || (extra.useMock !== '0' && API_URL === '');

/**
 * Hybrid mode: when talking to the live API, the few endpoints the backend does not serve yet are
 * answered by the in-app mock so those screens keep working. Switch off with
 * EXPO_PUBLIC_MOCK_MISSING=0 once the server has them (see MISSING_ON_SERVER below).
 */
export const MOCK_MISSING = !USE_MOCK && extra.mockMissing !== '0';

/**
 * Endpoints docs/domain-api.md and apps/api do not serve yet (the AI package is not wired into the API
 * routes). Delete a line here as soon as the server implements it.
 */
const MISSING_ON_SERVER: [method: string, path: RegExp][] = [
  ['POST', /^\/prescriptions\/upload-and-parse$/],
  ['GET', /^\/reports(\/|$)/],
  ['POST', /^\/reports\//],
  ['GET', /^\/drugs\//],
  ['GET', /^\/pharmacies(\/|$)/],
  ['PUT', /^\/pharmacies\//],
  ['GET', /^\/insights\//],
  ['POST', /^\/summaries\//],
  ['POST', /^\/symptoms\//],
  ['POST', /^\/voice\/transcribe$/],
  ['GET', /^\/account\/settings$/],
  ['PUT', /^\/account\/settings$/],
  ['POST', /^\/profiles\/[^/]+\/link\/(request|verify)$/],
];

/** True when this call must be answered by the in-app mock even though a live API is configured. */
export function isMockedPath(method: string, path: string): boolean {
  return MOCK_MISSING && MISSING_ON_SERVER.some(([m, re]) => m === method && re.test(path));
}
