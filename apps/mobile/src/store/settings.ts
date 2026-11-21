import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-device preferences. Not sensitive, so plain storage is fine. */
interface SettingsState {
  /** Larger-text option (design.md Screen 15). */
  largeText: boolean;
  /** Active dependent profile shown on Home. */
  activeProfileId: string | null;
  setLargeText: (v: boolean) => void;
  setActiveProfileId: (id: string | null) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      largeText: false,
      activeProfileId: null,
      setLargeText: (largeText) => set({ largeText }),
      setActiveProfileId: (activeProfileId) => set({ activeProfileId }),
    }),
    { name: 'uposhom.settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export const TEXT_SCALE_LARGE = 1.2;
