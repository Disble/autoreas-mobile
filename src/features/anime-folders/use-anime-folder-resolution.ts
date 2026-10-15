import { eq } from 'drizzle-orm';
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
 * Resolves the folder of every active anime (the same set the list shows) against the shared
 * folder index. Resolution runs over all of them at once, never a filtered list, so a folder two
 * animes share is detected whichever day or tab is on screen. `null` until an index exists.
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
            .select({ id: animes._id, carpeta: animes.carpeta, folderRelative: animes.folderRelative })
            .from(animes)
            .where(eq(animes.activo, 1))
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
