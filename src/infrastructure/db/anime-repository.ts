import { eq } from "drizzle-orm";
import type { Anime } from "../validation/anime-schema";
import type { AppDatabase } from "./client";
import { animes } from "./schema";

/** Executes the upsert anime operation. */
export async function upsertAnime(
  db: AppDatabase,
  anime: Anime,
  guardMs?: number,
): Promise<void> {
  const mappedFields = {
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
    ...(guardMs !== undefined ? { lastAppliedChangeMs: guardMs } : {}),
  };

  await db
    .insert(animes)
    .values({
      _id: anime._id,
      ...mappedFields,
    })
    .onConflictDoUpdate({
      target: animes._id,
      set: mappedFields,
    });
}

/**
 * Applies only the given columns to an existing `animes` row and advances the per-anime
 * staleness guard in the same statement. Used by the merge boundary to write a partial
 * update built from `changed_fields`, never the full snapshot row, so untouched local
 * fields (e.g. an in-flight optimistic `nrocapvisto`) are never clobbered. Complements
 * `upsertAnime`, which remains the cold-load/full-row writer for initial sync only.
 */
export async function applyAnimePartial(
  db: AppDatabase,
  recordId: string,
  partialColumns: Partial<Record<string, unknown>>,
  guardMs: number,
): Promise<void> {
  await db
    .update(animes)
    .set({ ...partialColumns, lastAppliedChangeMs: guardMs })
    .where(eq(animes._id, recordId));
}
