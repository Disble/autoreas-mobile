import { create } from 'zustand';

/**
 * Global season-mode state, mirrored from the bridge (the single source of truth).
 *
 * The bridge owns the flag: it pushes changes over the WebSocket (`preferences_changed`)
 * and exposes the current value on `GET /api/status`. This store is the app-wide, in-memory
 * projection the UI reads — the first real Zustand store in the project, per the documented
 * architecture (Arquitectura.md: Zustand for ephemeral global UI state, never domain data,
 * which stays in SQLite).
 *
 * It is intentionally NOT persisted locally: on cold start it defaults to `false` (matching
 * the bridge's missing-row sentinel) and is re-hydrated from the bridge as soon as the
 * connection is available.
 */
export interface SeasonModeStore {
  readonly seasonMode: boolean;
  readonly setSeasonMode: (seasonMode: boolean) => void;
}

export const useSeasonModeStore = create<SeasonModeStore>((set) => ({
  seasonMode: false,
  setSeasonMode: (seasonMode) => set({ seasonMode }),
}));
