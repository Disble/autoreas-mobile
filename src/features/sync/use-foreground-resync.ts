import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import { resyncFromBridgeSnapshot } from "./full-resync.helpers";

/**
 * Runs a snapshot-authoritative heal against the bridge's full anime list on the foreground
 * reactive connection: once on mount and again every time the app returns to the foreground.
 * This is what makes rows that drifted out of sync (or changes a background cycle missed)
 * converge without a manual pull-to-refresh, while never clobbering un-acked local edits
 * (the heal skips animes with a pending outbox op).
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
  const runResync = useCallback(() => {
    if (!rawDb) {
      return;
    }

    resyncFromBridgeSnapshot(rawDb).catch((error: unknown) => {
      console.warn("[useForegroundResync] Resync failed", error);
    });
  }, [rawDb]);

  // 7. Effects
  useEffect(() => {
    runResync();
  }, [runResync]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;

      if (previousAppState !== "active" && nextAppState === "active") {
        runResync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [runResync]);
  return undefined;
}
