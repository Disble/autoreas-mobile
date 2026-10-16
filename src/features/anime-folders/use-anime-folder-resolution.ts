import { useMemo } from 'react';
import { createDrizzleDb } from '../../infrastructure/db/client/client.helpers';
import {
  useOptionalLiveQuery,
  useOptionalSQLiteContext,
} from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { animes } from '../../infrastructure/db/schema';
import { EMPTY_ANIME_FOLDER_SOURCES } from './anime-folders.constants';
import { resolveAnimeFolders } from './anime-folders.helpers';
import type { AnimeFolderSource, FolderResolution } from './anime-folders.types';
import { useAnimeFolders } from './use-anime-folders';

/**
 * Resolves the folder of every stored anime against the shared folder index. Inactive animes are
 * included so the folders they use are not listed as without anime, but only active animes get a
 * button or make a folder shared (see `resolveAnimeFolders`). The card buttons and the Settings
 * summary read this one result, whichever day or tab is on screen. `null` until an index exists.
 */
export function useAnimeFolderResolution(): FolderResolution | null {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();
  const { index } = useAnimeFolders();

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
            })
            .from(animes)
        : null,
    [db],
  );
  const { data: sources } = useOptionalLiveQuery<readonly AnimeFolderSource[]>(
    query,
    EMPTY_ANIME_FOLDER_SOURCES,
  );

  // 5. Derived State
  const resolution = useMemo(
    () => (index ? resolveAnimeFolders(index, sources) : null),
    [index, sources],
  );

  // 6. Callbacks

  // 7. Effects

  return resolution;
}
