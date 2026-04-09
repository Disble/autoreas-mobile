import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import {
  createDrizzleDb,
  getBridgeConfigSnapshot,
  withExclusiveWrite,
} from '../../infrastructure/db/client';
import { operationLog, animes } from '../../infrastructure/db/schema';
import { AnimeSchema } from '../../infrastructure/validation/anime-schema';
import { z } from 'zod';

const AnimeChangeSchema = z.object({
  record_id: z.string(),
  change_type: z.enum(['create', 'update', 'delete']),
  changed_fields: z.array(z.string()),
  snapshot: AnimeSchema.optional(),
  timestamp: z.number(),
});

const ReconcileResponseSchema = z.object({
  status: z.string(),
  bridge_changes: z.array(AnimeChangeSchema),
  conflicts: z.array(z.unknown()),
});

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

  const baseUrl = `http://${config.ip}:${config.port}`;

  // Obtener el último changelog_id conocido (usamos el id más alto que ya sincronizamos)
  // Por simplicidad inicial: enviamos 0 para pedir todos los cambios del bridge
  // En una iteración futura esto se puede persistir en bridge_config o una tabla propia
  const lastChangelogId = 0;

  const requestBody = {
    device_id: config.deviceId ?? undefined,
    last_changelog_id: lastChangelogId,
    pending_operations: pendingOps.map((op) => ({
      anime_id: op.animeId,
      operation: op.operation,
      payload: (() => {
        try {
          return JSON.parse(op.payload);
        } catch {
          return {};
        }
      })(),
      created_at: op.createdAt,
    })),
  };

  const response = await fetch(`${baseUrl}/api/sync/reconcile`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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
  let syncedCount = 0;

  // Aplicar bridge_changes en la SQLite local
  await withExclusiveWrite(rawDb, async (writeDb) => {
    for (const change of bridge_changes) {
      if (change.change_type === 'delete') {
        await writeDb.delete(animes).where(eq(animes._id, change.record_id));
      } else if (change.snapshot) {
        const anime = change.snapshot;
        await writeDb
          .insert(animes)
          .values({
            _id: anime._id,
            nombre: anime.nombre,
            estado: anime.estado,
            nrocapvisto: anime.nrocapvisto,
            totalcap: anime.totalcap ?? null,
            activo: anime.activo,
            primeravez: anime.primeravez,
            dias: anime.dias ? JSON.stringify(anime.dias) : null,
            generos: anime.generos ? JSON.stringify(anime.generos) : null,
            tipo: anime.tipo ?? null,
            fechaUltCapVisto: anime.fechaUltCapVisto ?? null,
            fechaEstreno: anime.fechaEstreno ?? null,
            fechaCreacion: anime.fechaCreacion ?? null,
            fechaEliminacion: anime.fechaEliminacion ?? null,
            portada: anime.portada ?? null,
            pagina: anime.pagina ?? null,
            carpeta: anime.carpeta ?? null,
            estudios: anime.estudios ?? null,
            origen: anime.origen ?? null,
            duracion: anime.duracion ?? null,
          })
          .onConflictDoUpdate({
            target: animes._id,
            set: {
              nombre: anime.nombre,
              estado: anime.estado,
              nrocapvisto: anime.nrocapvisto,
              totalcap: anime.totalcap ?? null,
              activo: anime.activo,
              primeravez: anime.primeravez,
              dias: anime.dias ? JSON.stringify(anime.dias) : null,
              generos: anime.generos ? JSON.stringify(anime.generos) : null,
              tipo: anime.tipo ?? null,
              fechaUltCapVisto: anime.fechaUltCapVisto ?? null,
              fechaEstreno: anime.fechaEstreno ?? null,
              fechaCreacion: anime.fechaCreacion ?? null,
              fechaEliminacion: anime.fechaEliminacion ?? null,
              portada: anime.portada ?? null,
              pagina: anime.pagina ?? null,
              carpeta: anime.carpeta ?? null,
              estudios: anime.estudios ?? null,
              origen: anime.origen ?? null,
              duracion: anime.duracion ?? null,
            },
          });
      }
    }

    // Marcar las operaciones pendientes enviadas como synced
    for (const op of pendingOps) {
      await writeDb
        .update(operationLog)
        .set({ status: 'synced' })
        .where(eq(operationLog.id, op.id));
      syncedCount++;
    }
  });

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
