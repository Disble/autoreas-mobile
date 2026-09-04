import { desc, eq } from 'drizzle-orm';
import { useCallback, useMemo } from 'react';
import {
  buildSyncTelemetryPreferencePatch,
  isSyncTelemetryEnabled,
} from '../sync/sync-telemetry-preference.helpers';
import {
  createDrizzleDb,
  withLocalWrite,
} from '../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { bridgeConfig, type BridgeConfig } from '../../infrastructure/db/schema';

/** Coordinates the user-owned diagnostic-telemetry switch shown in Settings. */
export function useSyncTelemetryPreference() {
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

    return db.select().from(bridgeConfig).orderBy(desc(bridgeConfig.id)).limit(1);
  }, [db]);

  const { data: configs } = useOptionalLiveQuery<BridgeConfig[]>(query, []);

  // 5. Derived State (`useMemo`)
  const config = useMemo(() => configs?.[0] ?? null, [configs]);
  const isEnabled = useMemo(() => isSyncTelemetryEnabled(config), [config]);

  // 6. Callbacks (`useCallback` calling pure helpers)
  const setEnabled = useCallback(
    async (nextEnabled: boolean) => {
      // Both guards degrade silently rather than throwing: this switch lives on a Settings
      // screen the user may open before pairing, and a diagnostics preference must never be
      // the thing that breaks that screen. With no paired row there is nothing to UPDATE --
      // issuing one anyway would match zero rows and leave the switch lying about what landed.
      if (!rawDb || !config) {
        return;
      }

      await withLocalWrite(rawDb, async (writeDb) => {
        await writeDb
          .update(bridgeConfig)
          .set(buildSyncTelemetryPreferencePatch(nextEnabled))
          .where(eq(bridgeConfig.id, config.id));
      });
    },
    [config, rawDb],
  );

  // 7. Effects

  return { isEnabled, setEnabled };
}
