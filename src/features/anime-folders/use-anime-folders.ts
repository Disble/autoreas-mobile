import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { appPreferences, type AppPreferencesRow } from '../../infrastructure/db/schema';
import {
  dismissAnimeFoldersHint,
  saveAnimeFoldersRoot,
  toAnimeFoldersPreferences,
} from './anime-folders-preferences.helpers';
import { ANIME_FOLDERS_INITIAL_URI } from './anime-folders.constants';
import { pickSafRoot } from './anime-folders-io.helpers';
import { formatRootLabel } from './anime-folders.helpers';
import {
  getAnimeFoldersIndexState,
  indexAnimeFolders,
  recheckAnimeFoldersAccess,
  subscribeAnimeFoldersIndex,
} from './anime-folders.store';
import type { AnimeFoldersView } from './anime-folders.types';

/**
 * Exposes the chosen anime root (from `app_preferences`) and its shared folder index. Indexes the
 * root once it is known and whenever it changes, and owns choosing the root and dismissing the hint; every mounted caller shares one index run. When
 * the app returns to the foreground it only re-checks access, never walks the tree again.
 */
export function useAnimeFolders(): AnimeFoldersView {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const indexState = useSyncExternalStore(subscribeAnimeFoldersIndex, getAnimeFoldersIndexState);

  // 4. Queries/Mutations
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const query = useMemo(() => (db ? db.select().from(appPreferences).limit(1) : null), [db]);
  const { data: rows, status } = useOptionalLiveQuery<AppPreferencesRow[]>(query, []);

  // 5. Derived State
  const isLoaded = status === 'loaded';
  const { rootUri, hintDismissedAt } = toAnimeFoldersPreferences(rows[0]);
  const rootLabel = rootUri ? formatRootLabel(rootUri) : null;

  // 6. Callbacks
  const reindex = useCallback(() => {
    void indexAnimeFolders(rootUri, true);
  }, [rootUri]);

  const chooseRoot = useCallback(async (): Promise<string | null> => {
    const pickedUri = await pickSafRoot(ANIME_FOLDERS_INITIAL_URI);
    if (!pickedUri || !rawDb) {
      return null;
    }

    try {
      await withLocalWrite(rawDb, (writeDb) => saveAnimeFoldersRoot(writeDb, pickedUri));
    } catch (error) {
      console.warn('[anime-folders] could not save the chosen root', error);
      return null;
    }

    // Forced: picking the same folder again (a new grant after losing access) must re-index it.
    await indexAnimeFolders(pickedUri, true);
    return pickedUri;
  }, [rawDb]);

  const dismissHint = useCallback(() => {
    if (!rawDb) {
      return;
    }

    withLocalWrite(rawDb, (writeDb) => dismissAnimeFoldersHint(writeDb, Date.now())).catch(
      (error: unknown) => {
        console.warn('[anime-folders] could not dismiss the hint', error);
      },
    );
  }, [rawDb]);

  // 7. Effects
  useEffect(() => {
    if (isLoaded) {
      void indexAnimeFolders(rootUri);
    }
  }, [isLoaded, rootUri]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void recheckAnimeFoldersAccess();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return { ...indexState, isLoaded, rootLabel, hintDismissedAt, reindex, chooseRoot, dismissHint };
}
