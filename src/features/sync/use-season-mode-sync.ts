import { useEffect } from 'react';
import { useOptionalSQLiteContext } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { useSeasonModeStore } from '../../infrastructure/store/season-mode-store';
import { fetchSeasonModeFromBridge } from './season-mode-sync.helpers';
import type { UseSeasonModeSyncProps } from './season-mode-sync.types';

/** Coordinates season mode sync state and actions. */
export function useSeasonModeSync({ enabled }: UseSeasonModeSyncProps): void {
  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const setSeasonMode = useSeasonModeStore((state) => state.setSeasonMode);

  // 7. Effects
  useEffect(() => {
    if (!enabled || !rawDb) {
      return;
    }

    let active = true;

    void fetchSeasonModeFromBridge(rawDb).then((value) => {
      if (active && value !== null) {
        setSeasonMode(value);
      }
    });

    return () => {
      active = false;
    };
  }, [enabled, rawDb, setSeasonMode]);
  return undefined;
}
