import { useCallback, useState } from 'react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { DATABASE_NAME } from '../../infrastructure/db/client/client.constants';
import { getSQLiteProvider } from '../../infrastructure/db/native-runtime/native-runtime.helpers';
import { STARTUP_SQLITE_OPTIONS } from './startup.constants';
import { createStartupDatabaseInitializer } from './startup.helpers';
import type { StartupState, UseStartupResult } from './startup.types';

/** Coordinates bounded local application readiness before routes and runtime services mount. */
export function useStartup(): UseStartupResult {
  // 2. State
  const [startupState, setStartupState] = useState<StartupState>({
    failure: null,
    phase: 'preparing_database',
    target: null,
  });
  const [sqliteProvider] = useState(getSQLiteProvider);
  // The provider's live connection, captured by the initializer the instant `onInit` runs. State
  // rather than a ref so the React Compiler can optimize this hook: writing a ref from the
  // initializer closure is a ref access during render, which the compiler refuses to memoize. The
  // recovery surface renders outside `SQLiteProvider`, so this is how the reset reaches the
  // handle it must close before deleting the database.
  const [activeDatabase, setActiveDatabase] = useState<SQLiteDatabase | null>(null);
  const [handleDatabaseInit, setHandleDatabaseInit] = useState(() =>
    createStartupDatabaseInitializer({
      onDatabaseOpened: (database) => {
        setActiveDatabase(database);
      },
      setStartupState,
    }),
  );

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const isReady = startupState.phase === 'ready';

  // 6. Callbacks (`useCallback` calling pure helpers)
  /**
   * Discards the current provider mount and returns startup to its initial state.
   *
   * Clearing the terminal failure is part of the remount, not a side effect of it: the recovery
   * card replaces the provider for every startup failure, so a retained failure would keep that
   * card mounted, the fresh provider would never render, and its preparation would never run.
   */
  const getActiveDatabase = useCallback(
    (): SQLiteDatabase | null => activeDatabase,
    [activeDatabase],
  );
  const remountDatabaseProvider = useCallback((): void => {
    setStartupState({ failure: null, phase: 'preparing_database', target: null });
    // The setter stores the updater's own return value, so this mounts a genuinely NEW initializer.
    // `expo-sqlite` reopens the database only when `onInit` changes -- `SQLiteProvider`'s memo
    // comparator compares it, and `getDatabaseAsync` compares it against the connection it cached
    // -- so re-rendering the previous callback would replay that connection's opening promise and
    // re-run no preparation at all.
    setHandleDatabaseInit(() =>
      createStartupDatabaseInitializer({
        onDatabaseOpened: (database) => {
          setActiveDatabase(database);
        },
        setStartupState,
      }),
    );
  }, []);

  // 7. Effects

  return {
    databaseName: DATABASE_NAME,
    getActiveDatabase,
    handleDatabaseInit,
    isReady,
    remountDatabaseProvider,
    sqliteOptions: STARTUP_SQLITE_OPTIONS,
    sqliteProvider,
    startupState,
  };
}
