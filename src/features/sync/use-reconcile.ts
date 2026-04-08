import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import {
  createDrizzleDb,
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from '../../infrastructure/db/client';
import { operationLog } from '../../infrastructure/db/schema';

export async function syncPendingOperations(rawDb: SQLiteDatabase) {
  const db = createDrizzleDb(rawDb);

  const config = await getBridgeConfigSnapshot(rawDb);
  if (!config?.ip || !config?.port || !config?.token) {
    throw new Error('Bridge config is missing or incomplete');
  }

  const pendingOps = await db
    .select()
    .from(operationLog)
    .where(eq(operationLog.status, 'pending'));

  if (pendingOps.length === 0) return 0;

  const baseUrl = `http://${config.ip}:${config.port}`;
  let syncedCount = 0;

  for (const op of pendingOps) {
    try {
      // Intentamos parsear el payload. Si falla, el catch lo atrapa y no crashea
      const payload = JSON.parse(op.payload);
      const url = `${baseUrl}/api/animes/${op.animeId}`;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        // Marcamos como synced con write exclusivo
        await withExclusiveWrite(rawDb, async (writeDb) => {
          await writeDb
            .update(operationLog)
            .set({ status: 'synced' })
            .where(eq(operationLog.id, op.id));
        });
        syncedCount++;
      }
      // Si la respuesta no es OK (ej. 404, 500), se ignora y se mantiene en pending
    } catch (error) {
      // Error de red o JSON parse -> se mantiene pending
      console.warn(`[Sync] Falló la operación ${op.id}:`, error);
    }
  }

  return syncedCount;
}

export function useReconcile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rawDb: SQLiteDatabase) => syncPendingOperations(rawDb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operationLog'] });
    },
  });
}
