import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { syncRuntimeStatus, type SyncRuntimeStatusRow } from '../../infrastructure/db/schema';
import {
  DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT,
  UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT,
} from '../sync/sync-runtime-status.constants';
import { mapSyncRuntimeStatusRowToSnapshot } from '../sync/sync-runtime-status.helpers';
import type { UseBackgroundSyncStatusResult } from './background-sync-status.types';

/** Coordinates background sync status state and actions. */
export function useBackgroundSyncStatus(): UseBackgroundSyncStatusResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const query = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(syncRuntimeStatus).limit(1);
  }, [db]);
  const { data: snapshots } = useOptionalLiveQuery<SyncRuntimeStatusRow[]>(query, []);

  // 5. Derived State (`useMemo`)
  // Delegates the per-column default-filling to `mapSyncRuntimeStatusRowToSnapshot` -- the SAME
  // mapping `getSyncRuntimeStatusSnapshot` uses -- instead of duplicating that tail here (D7's
  // `?? null` rule for the eight convergence counters lives in exactly one place this way).
  // No manual `useMemo` here: the React Compiler (`reactCompiler: true`, app.json) memoizes this
  // derivation on its own (react-doctor: `react-compiler-no-manual-memoization`).
  const latestSnapshot = snapshots[0];
  const snapshot = !rawDb
    ? UNSUPPORTED_SYNC_RUNTIME_STATUS_SNAPSHOT
    : latestSnapshot
      ? mapSyncRuntimeStatusRowToSnapshot(latestSnapshot)
      : DEFAULT_SYNC_RUNTIME_STATUS_SNAPSHOT;

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects

  return { snapshot };
}
