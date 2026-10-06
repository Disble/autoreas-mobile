import { useMemo } from 'react';
import { createDrizzleDb } from '../../../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../../../infrastructure/db/native-runtime/native-runtime.helpers';
import { appPreferences, type AppPreferencesRow } from '../../../../infrastructure/db/schema';
import { toBatteryExemptionPreferences } from '../../battery-exemption-preferences.helpers';
import type { BatteryExemptionStoredPreferences } from './battery-exemption-prompt.types';

/**
 * Reads the battery-exemption dialog history from the `app_preferences` singleton. `isLoaded`
 * stays false until the live query has answered, so its empty first render is never mistaken
 * for "never shown".
 */
export function useBatteryExemptionPreferences(): BatteryExemptionStoredPreferences {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const query = useMemo(() => (db ? db.select().from(appPreferences).limit(1) : null), [db]);
  const { data: rows, status } = useOptionalLiveQuery<AppPreferencesRow[]>(query, []);

  // 5. Derived State
  const preferences = toBatteryExemptionPreferences(rows[0]);

  // 6. Callbacks

  // 7. Effects

  return { rawDb, preferences, isLoaded: status === 'loaded' };
}
