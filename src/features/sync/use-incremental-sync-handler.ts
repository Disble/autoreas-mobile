import { useCallback } from "react";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime";
import { incrementalSync } from "./use-initial-sync";
import type { UseIncrementalSyncHandlerResult } from "./incremental-sync-handler.types";

export function useIncrementalSyncHandler(): UseIncrementalSyncHandlerResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)
  const handleSyncRequired = useCallback(async () => {
    if (!rawDb) {
      return;
    }

    await incrementalSync(rawDb, 0);
  }, [rawDb]);

  // 7. Effects

  return { handleSyncRequired };
}
