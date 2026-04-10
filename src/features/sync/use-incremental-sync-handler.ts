import { useCallback } from "react";
import type { UseIncrementalSyncHandlerResult } from "./incremental-sync-handler.types";
import { useSyncFacade } from './use-sync-facade';

export function useIncrementalSyncHandler(): UseIncrementalSyncHandlerResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const { manualSync } = useSyncFacade();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleSyncRequired = useCallback(async () => {
    await manualSync();
  }, [manualSync]);

  // 7. Effects

  return { handleSyncRequired };
}
