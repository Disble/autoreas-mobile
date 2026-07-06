import { useCallback, useEffect, useState } from 'react';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime';
import { useActiveSeasonStore } from '../../infrastructure/store/active-season-store';
import { fetchActiveSeasonFromBridge } from './use-season-sync.helpers';
import type { UseSeasonSyncProps, UseSeasonSyncResult } from './use-season-sync.types';

export function useSeasonSync({ enabled }: UseSeasonSyncProps): UseSeasonSyncResult {
  // 1. Refs

  // 2. State
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const setActiveSeasonSnapshot = useActiveSeasonStore((state) => state.setActiveSeasonSnapshot);

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)
  const refreshActiveSeason = useCallback(async () => {
    if (!enabled || !rawDb) {
      return;
    }

    setIsRefreshing(true);

    try {
      const snapshot = await fetchActiveSeasonFromBridge(rawDb);

      setActiveSeasonSnapshot(snapshot);
    } catch {
      setActiveSeasonSnapshot(null);
    } finally {
      setIsRefreshing(false);
    }
  }, [enabled, rawDb, setActiveSeasonSnapshot]);

  // 7. Effects
  useEffect(() => {
    if (!enabled || !rawDb) {
      return;
    }

    void refreshActiveSeason();
  }, [enabled, rawDb, refreshActiveSeason]);

  return {
    isRefreshing,
    refreshActiveSeason,
  };
}
