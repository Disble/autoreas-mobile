import { useMemo } from "react";
import { EXPO_SQLITE_UNAVAILABLE_MESSAGE } from "../../infrastructure/db/native-runtime/native-runtime.constants";
import type { UseSQLiteUnavailableMessageResult } from "./sqlite-unavailable-message.types";

/** Coordinates sqlite unavailable message state and actions. */
export function useSQLiteUnavailableMessage(): UseSQLiteUnavailableMessageResult {
  // 1. Refs

  // 2. State

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (`useMemo`)
  const message = useMemo(() => EXPO_SQLITE_UNAVAILABLE_MESSAGE, []);

  // 6. Callbacks (`useCallback` calling pure helpers)

  // 7. Effects

  return { message };
}
