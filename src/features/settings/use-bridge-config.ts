import { desc } from 'drizzle-orm';
import { useCallback, useMemo, useState } from 'react';
import { clearBridgeConfig, createDrizzleDb } from '../../infrastructure/db/client';
import {
  getExpoSQLiteUnavailableError,
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime';
import { bridgeConfig, type BridgeConfig } from '../../infrastructure/db/schema';

export function useBridgeConfig() {
  const rawDb = useOptionalSQLiteContext();
  const [isUnpairing, setIsUnpairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);

  const query = useMemo(() => {
    if (!db) {
      return null;
    }

    return db.select().from(bridgeConfig).orderBy(desc(bridgeConfig.id)).limit(1);
  }, [db]);

  const { data: configs } = useOptionalLiveQuery<BridgeConfig[]>(query, []);

  const config = configs?.[0] ?? null;
  const isConfigured = !!config?.deviceId;

  const unpair = useCallback(async () => {
    setIsUnpairing(true);
    setError(null);

    try {
      if (!rawDb) {
        throw getExpoSQLiteUnavailableError();
      }

      await clearBridgeConfig(rawDb);
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsUnpairing(false);
    }
  }, [rawDb]);

  return {
    config,
    isConfigured,
    isUnpairing,
    error,
    unpair,
  };
}
