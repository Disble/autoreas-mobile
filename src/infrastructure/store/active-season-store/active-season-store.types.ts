import type { ActiveSeasonSnapshot } from '../../api';

/**
 * Global active-season projection mirrored from bridge-owned contracts.
 * The store stays ephemeral so stale season truth never survives a cold start without bridge hydration.
 */
export interface ActiveSeasonStore {
  readonly activeSeasonSnapshot: ActiveSeasonSnapshot | null;
  readonly setActiveSeasonSnapshot: (snapshot: ActiveSeasonSnapshot | null) => void;
}
