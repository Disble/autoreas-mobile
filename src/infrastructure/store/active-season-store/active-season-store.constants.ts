import { create } from 'zustand';
import type { ActiveSeasonStore } from './active-season-store.types';

/** Provides the shared use active season store value. */

export const useActiveSeasonStore = create<ActiveSeasonStore>((set) => ({
  activeSeasonSnapshot: null,
  setActiveSeasonSnapshot: (activeSeasonSnapshot) => set({ activeSeasonSnapshot }),
}));
