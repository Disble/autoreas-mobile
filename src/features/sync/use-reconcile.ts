import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eq, inArray } from "drizzle-orm";
import { type SQLiteDatabase } from "expo-sqlite";
import { upsertAnime } from "../../infrastructure/db/anime-repository";
import {
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from "../../infrastructure/db/client";
import { animes, operationLog, type OperationLogRow } from "../../infrastructure/db/schema";
import {
  buildReconcileRequestBody,
  getConfirmedOperationIds,
} from "./reconcile.helpers";
import { syncStateByDatabase } from "./reconcile.constants";
import { ReconcileResponseSchema } from "./reconcile.schema";

export async function syncPendingOperations(rawDb: SQLiteDatabase) {
  async function performSyncPendingOperations() {
    const config = await getBridgeConfigSnapshot(rawDb);
    if (!config?.ip || !config?.port || !config?.token) {
      throw new Error("Bridge config is missing or incomplete");
    }

    let pendingOps: OperationLogRow[] = [];

    await withExclusiveWrite(rawDb, async (writeDb) => {
      pendingOps = await writeDb
        .select()
        .from(operationLog)
        .where(eq(operationLog.status, "pending"));

      if (pendingOps.length === 0) {
        return;
      }

      await writeDb
        .update(operationLog)
        .set({ status: "processing" })
        .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
    });

    const baseUrl = `http://${config.ip}:${config.port}`;
    const lastChangelogId = 0;
    const requestBody = buildReconcileRequestBody(
      config.deviceId ?? undefined,
      lastChangelogId,
      pendingOps,
    );

    try {
      const response = await fetch(`${baseUrl}/api/sync/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Reconcile failed: ${response.status}`);
      }

      const raw = await response.json();
      const parsed = ReconcileResponseSchema.safeParse(raw);

      if (!parsed.success) {
        throw new Error(`Invalid reconcile response: ${parsed.error.message}`);
      }

      const { bridge_changes } = parsed.data;
      const confirmedIds = getConfirmedOperationIds(pendingOps, bridge_changes);
      const unconfirmedIds = pendingOps
        .map((operation) => operation.id)
        .filter((id) => !confirmedIds.includes(id));

      await withExclusiveWrite(rawDb, async (writeDb) => {
        for (const change of bridge_changes) {
          if (change.change_type === "delete") {
            await writeDb.delete(animes).where(eq(animes._id, change.record_id));
          } else if (change.snapshot) {
            await upsertAnime(writeDb, change.snapshot);
          }
        }

        if (confirmedIds.length > 0) {
          await writeDb
            .update(operationLog)
            .set({ status: "synced" })
            .where(inArray(operationLog.id, confirmedIds));
        }

        if (unconfirmedIds.length > 0) {
          await writeDb
            .update(operationLog)
            .set({ status: "pending" })
            .where(inArray(operationLog.id, unconfirmedIds));
        }
      });

      return confirmedIds.length;
    } catch (error) {
      if (pendingOps.length > 0) {
        await withExclusiveWrite(rawDb, async (writeDb) => {
          await writeDb
            .update(operationLog)
            .set({ status: "pending" })
            .where(inArray(operationLog.id, pendingOps.map((operation) => operation.id)));
        });
      }

      throw error;
    }
  }

  const syncKey = rawDb as object;
  const syncState = syncStateByDatabase.get(syncKey) ?? {
    inFlight: null,
    rerunRequested: false,
  };

  if (syncState.inFlight) {
    syncState.rerunRequested = true;
    syncStateByDatabase.set(syncKey, syncState);
    return syncState.inFlight;
  }

  const run = async (): Promise<number> => {
    let totalConfirmed = 0;

    do {
      syncState.rerunRequested = false;
      totalConfirmed += await performSyncPendingOperations();
    } while (syncState.rerunRequested);

    return totalConfirmed;
  };

  syncState.inFlight = run().finally(() => {
    syncState.inFlight = null;
    syncState.rerunRequested = false;
  });
  syncStateByDatabase.set(syncKey, syncState);

  return syncState.inFlight;
}

export function useReconcile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rawDb: SQLiteDatabase) => syncPendingOperations(rawDb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["operationLog"] });
    },
  });
}
