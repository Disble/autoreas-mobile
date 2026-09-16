import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import { runForegroundResyncCycle } from "./foreground-resync-cycle.helpers";

/**
 * Runs one foreground resync cycle -- hydrate the offline cover store, heal local anime rows
 * against the bridge's full snapshot, then sweep for cover updates -- on the foreground reactive
 * connection: once on mount and again every time the app returns to the foreground. This is what
 * makes rows that drifted out of sync (or changes a background cycle missed) converge without a
 * manual pull-to-refresh, while never clobbering un-acked local edits (the heal skips animes with
 * a pending outbox op). The cycle itself lives in `runForegroundResyncCycle`
 * (`foreground-resync-cycle.helpers.ts`); this hook only decides WHEN to call it.
 */
export function useForegroundResync(): void {
  // 1. Refs
  const currentAppStateRef = useRef(AppState.currentState);

  // 2. State

  // 3. Context/3rd Party Hooks
  const rawDb = useOptionalSQLiteContext();

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects
  useEffect(() => {
    void runForegroundResyncCycle(rawDb);
  }, [rawDb]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;

      if (previousAppState !== "active" && nextAppState === "active") {
        void runForegroundResyncCycle(rawDb);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [rawDb]);
  return undefined;
}
