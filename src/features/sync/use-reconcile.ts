import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type SQLiteDatabase } from "expo-sqlite";
import { syncPendingOperations } from "./reconcile.helpers";

export function useReconcile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rawDb: SQLiteDatabase) => syncPendingOperations(rawDb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operationLog"] });
    },
  });
}
