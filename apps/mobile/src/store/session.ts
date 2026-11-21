import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import type { SessionUser } from '@uposhom/shared';

/**
 * Tokens live in expo-secure-store (Android Keystore backed), never in plain storage.
 * The JWT only carries our own ids: no phone number and no Applink subscriberId.
 */
const KEYS = {
  access: 'uposhom.access',
  refresh: 'uposhom.refresh',
  user: 'uposhom.user',
} as const;

// expo-secure-store has no web implementation; the web build is only a developer preview.
const memory = new Map<string, string>();
const store = {
  get: async (k: string) =>
    Platform.OS === 'web' ? (memory.get(k) ?? null) : SecureStore.getItemAsync(k),
  set: async (k: string, v: string) => {
    if (Platform.OS === 'web') memory.set(k, v);
    else await SecureStore.setItemAsync(k, v);
  },
  del: async (k: string) => {
    if (Platform.OS === 'web') memory.delete(k);
    else await SecureStore.deleteItemAsync(k);
  },
};

interface SessionState {
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  /** Account type picked on sign-up step 1, sent with the first OTP verify. */
  pendingAccountType: 'INDIVIDUAL' | 'PHARMACY' | null;
  /** Permissions + battery onboarding finished once after sign-in. */
  onboarded: boolean;
  hydrate: () => Promise<void>;
  setSession: (s: { token: string; refreshToken?: string; user: SessionUser }) => Promise<void>;
  setTokens: (token: string, refreshToken?: string) => Promise<void>;
  setPendingAccountType: (t: 'INDIVIDUAL' | 'PHARMACY') => void;
  setOnboarded: (v: boolean) => Promise<void>;
  clear: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  hydrated: false,
  accessToken: null,
  refreshToken: null,
  user: null,
  pendingAccountType: null,
  onboarded: false,

  hydrate: async () => {
    try {
      const [access, refresh, user, onboarded] = await Promise.all([
        store.get(KEYS.access),
        store.get(KEYS.refresh),
        store.get(KEYS.user),
        store.get('uposhom.onboarded'),
      ]);
      set({
        accessToken: access,
        refreshToken: refresh,
        user: user ? (JSON.parse(user) as SessionUser) : null,
        onboarded: onboarded === '1',
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setSession: async ({ token, refreshToken, user }) => {
    await store.set(KEYS.access, token);
    if (refreshToken) await store.set(KEYS.refresh, refreshToken);
    await store.set(KEYS.user, JSON.stringify(user));
    set({ accessToken: token, refreshToken: refreshToken ?? get().refreshToken, user });
  },

  setTokens: async (token, refreshToken) => {
    await store.set(KEYS.access, token);
    if (refreshToken) await store.set(KEYS.refresh, refreshToken);
    set({ accessToken: token, refreshToken: refreshToken ?? get().refreshToken });
  },

  setPendingAccountType: (t) => set({ pendingAccountType: t }),

  setOnboarded: async (v) => {
    await store.set('uposhom.onboarded', v ? '1' : '0');
    set({ onboarded: v });
  },

  clear: async () => {
    await Promise.all([
      store.del(KEYS.access),
      store.del(KEYS.refresh),
      store.del(KEYS.user),
      store.del('uposhom.onboarded'),
    ]);
    set({
      accessToken: null,
      refreshToken: null,
      user: null,
      onboarded: false,
      pendingAccountType: null,
    });
  },
}));
