import { useState } from 'react';
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
  const [handleDatabaseInit] = useState(() =>
    createStartupDatabaseInitializer({ setStartupState }),
  );

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const isReady = startupState.phase === 'ready';

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects

  return {
    databaseName: DATABASE_NAME,
    handleDatabaseInit,
    isReady,
    sqliteOptions: STARTUP_SQLITE_OPTIONS,
    sqliteProvider,
    startupState,
  };
}
