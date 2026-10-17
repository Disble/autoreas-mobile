import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useOptionalSQLiteContext } from "../../infrastructure/db/native-runtime/native-runtime.helpers";
import { hydrateCoverUris } from "./cover-sweep/cover-sweep.helpers";

/**
 * Starts hydrating the offline cover store from disk on mount and again every time the app returns
 * to the foreground. The snapshot heal those same events used to run here is now a demand of the
 * dispatched cycle (`bootstrap` and `app_active` always heal, ADR 009 R-7), which also starts the
 * cover sweep after the heal. Declared before the runtime's own mount and resume handlers, so the
 * hydrate still starts before the heal. Never awaited: it never rejects, and chapter data must
 * never wait for the cover-store mutex.
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
    if (rawDb) {
      void hydrateCoverUris();
    }
  }, [rawDb]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const previousAppState = currentAppStateRef.current;

      currentAppStateRef.current = nextAppState;

      if (rawDb && previousAppState !== "active" && nextAppState === "active") {
        void hydrateCoverUris();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [rawDb]);
  return undefined;
}
