import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime";
import { drainPendingRemoteChanges } from "./remote-change-drain.helpers";

/**
 * Drains background-staged `pending_remote_changes` rows into `animes` on the foreground
 * reactive connection so headless/background-applied remote changes become visible to
 * `useLiveQuery` consumers without an app restart. Runs once on mount (covers staged rows
 * left over from a prior background cycle that finished while the app was closed) and again
 * every time the app transitions into the foreground (covers a background cycle that ran
 * while this screen was already mounted but backgrounded).
 */
export function useRemoteChangeDrain(): void {
  // 1. Refs
  const currentAppStateRef = useRef(AppState.currentState);

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)
  const runDrain = useCallback(() => {
    if (!rawDb) {
      return;
    }

    drainPendingRemoteChanges(rawDb).catch((error: unknown) => {
      console.warn("[useRemoteChangeDrain] Drain failed", error);
    });
  }, [rawDb]);

  // 7. Effects
  useEffect(() => {
    runDrain();
  }, [runDrain]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;

      if (previousAppState !== "active" && nextAppState === "active") {
        runDrain();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [runDrain]);
}
