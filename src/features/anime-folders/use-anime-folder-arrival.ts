import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { animes } from '../../infrastructure/db/schema';
import { EMPTY_ANIME_FOLDER_ARRIVAL_SOURCES } from './anime-folders.constants';
import { findArrivedAnimes } from './anime-folders.helpers';
import { probeAnimeFolders } from './anime-folders.store';
import type { AnimeFolderArrivalSource } from './anime-folders.types';

/**
 * Finds anime folders that reach the tablet after their anime (a Season create arrives before its
 * first episode makes the folder). Checks the pending animes of an incoming event the moment it
 * lands, and every pending anime when the app returns to the foreground; no timers, no delays.
 * Mount it once, on the screen that stays mounted while the app is open.
 */
export function useAnimeFolderArrival(): void {
  // 1. Refs
  const lastChangeByIdRef = useRef<ReadonlyMap<string, number | null> | null>(null);
  const sourcesRef = useRef<readonly AnimeFolderArrivalSource[]>(EMPTY_ANIME_FOLDER_ARRIVAL_SOURCES);

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations
  const db = useMemo(() => (rawDb ? createDrizzleDb(rawDb) : null), [rawDb]);
  const query = useMemo(
    () =>
      db
        ? db
            .select({
              id: animes._id,
              carpeta: animes.carpeta,
              folderRelative: animes.folderRelative,
              activo: animes.activo,
              lastAppliedChangeMs: animes.lastAppliedChangeMs,
            })
            .from(animes)
        : null,
    [db],
  );
  const { data: sources, status } = useOptionalLiveQuery<readonly AnimeFolderArrivalSource[]>(
    query,
    EMPTY_ANIME_FOLDER_ARRIVAL_SOURCES,
  );

  // 5. Derived State
  const isLoaded = status === 'loaded';

  // 6. Callbacks

  // 7. Effects
  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    sourcesRef.current = sources;
    const previous = lastChangeByIdRef.current;
    lastChangeByIdRef.current = new Map(sources.map((source) => [source.id, source.lastAppliedChangeMs]));
    // The first read is the baseline: the initial walk already looks for every folder.
    const arrived = previous ? findArrivedAnimes(previous, sources) : [];
    if (arrived.length > 0) {
      void probeAnimeFolders(arrived);
    }
  }, [isLoaded, sources]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void probeAnimeFolders(sourcesRef.current);
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);
}
