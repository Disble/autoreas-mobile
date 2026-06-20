import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type SQLiteDatabase } from "expo-sqlite";
import { syncPendingOperations } from "./reconcile.helpers";

export function useReconcile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (rawDb: SQLiteDatabase) => {
      const result = await syncPendingOperations(rawDb);

      return result.syncedCount;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operationLog"] });
    },
  });
}
