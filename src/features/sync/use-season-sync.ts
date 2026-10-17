import { useCallback, useEffect } from 'react';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { useActiveSeasonStore } from '../../infrastructure/store/active-season-store';
import type { ActiveSeasonSnapshot } from '../../infrastructure/api';
import {
  beginActiveSeasonRefresh,
  invalidateActiveSeasonRefresh,
  isCurrentActiveSeasonRefresh,
} from './active-season-refresh.helpers';
import {
  clearCachedActiveSeasonSnapshot,
  fetchActiveSeasonFromBridge,
  readCachedActiveSeasonSnapshot,
  writeCachedActiveSeasonSnapshot,
} from './season-sync.helpers';
import type { UseSeasonSyncProps, UseSeasonSyncResult } from './season-sync.types';

/** Coordinates season sync state and actions. */
export function useSeasonSync({ enabled }: UseSeasonSyncProps): UseSeasonSyncResult {
  // 1. Refs
  // The refresh generation is shared with the dispatched cycle (`active-season-refresh.helpers`),
  // so a clear here also makes a cycle's refresh in flight stale.

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const setActiveSeasonSnapshot = useActiveSeasonStore((state) => state.setActiveSeasonSnapshot);

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)
  const clearActiveSeason = useCallback(async () => {
    invalidateActiveSeasonRefresh();
    setActiveSeasonSnapshot(null);

    if (!rawDb) {
      return;
    }

    try {
      await clearCachedActiveSeasonSnapshot(rawDb);
    } catch {
      // The in-memory deactivation remains authoritative if cache cleanup fails.
    }
  }, [rawDb, setActiveSeasonSnapshot]);

  const refreshActiveSeason = useCallback(async () => {
    if (!enabled || !rawDb) {
      return;
    }

    const refreshGeneration = beginActiveSeasonRefresh();

    try {
      let cachedSnapshot: ActiveSeasonSnapshot | null = null;

      try {
        cachedSnapshot = await readCachedActiveSeasonSnapshot(rawDb);
      } catch {
        // A cache read failure must not prevent a live bridge refresh.
      }

      if (
        cachedSnapshot !== null &&
        isCurrentActiveSeasonRefresh(refreshGeneration)
      ) {
        setActiveSeasonSnapshot(cachedSnapshot);
      }

      const snapshot = await fetchActiveSeasonFromBridge(rawDb);

      if (!isCurrentActiveSeasonRefresh(refreshGeneration)) {
        return;
      }

      setActiveSeasonSnapshot(snapshot);

      if (snapshot) {
        try {
          await writeCachedActiveSeasonSnapshot(rawDb, snapshot);
        } catch {
          // The in-memory bridge result remains usable even if it cannot be cached.
        }
      } else {
        await clearActiveSeason();
      }
    } catch {
      // Keep the restored snapshot while offline; a transport failure is not proof the season ended.
    }
  }, [clearActiveSeason, enabled, rawDb, setActiveSeasonSnapshot]);

  // 7. Effects
  useEffect(() => {
    if (!enabled || !rawDb) {
      return;
    }

    void refreshActiveSeason();
  }, [enabled, rawDb, refreshActiveSeason]);

  return {
    clearActiveSeason,
    refreshActiveSeason,
  };
}
