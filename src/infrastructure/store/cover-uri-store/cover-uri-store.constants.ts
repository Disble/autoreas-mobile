import { create } from 'zustand';
import type { CoverUriStore } from './cover-uri-store.types';

/** Provides the shared use cover uri store value. */

export const useCoverUriStore = create<CoverUriStore>((set) => ({
  coverUriByAnimeId: {},
  setCoverUris: (coverUriByAnimeId) => set({ coverUriByAnimeId }),
}));
