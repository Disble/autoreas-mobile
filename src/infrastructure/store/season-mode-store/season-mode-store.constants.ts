import { create } from 'zustand';
import type { SeasonModeStore } from './season-mode-store.types';

/** Provides the shared use season mode store value. */

export const useSeasonModeStore = create<SeasonModeStore>((set) => ({
  seasonMode: false,
  setSeasonMode: (seasonMode) => set({ seasonMode }),
}));
