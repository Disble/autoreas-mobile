import { eq, inArray } from "drizzle-orm";
import type { ConfirmedAnimeToken } from "../../../features/sync/applied-operation-token.helpers";
import type { Anime } from "../../validation/anime-schema";
import { buildOptionalAnimeSyncColumns } from "./anime-repository.helpers";
import type { AppDatabase } from "../client";
import { animes } from "../schema";

/**
 * Executes the upsert anime operation. `guardMs` stays the 3rd parameter for source
 * compatibility; `bridgeModifiedAt` is the 4th, optional, OCC-token slot.
 */
export async function upsertAnime(
  db: AppDatabase,
  anime: Anime,
  guardMs?: number,
  bridgeModifiedAt?: number,
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
    ...buildOptionalAnimeSyncColumns(guardMs, bridgeModifiedAt),
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

/**
 * Writes ONLY `bridge_modified_at` for the given record id. Never touches a domain column or
 * the `last_applied_change_ms` staleness guard -- column disjointness is what lets this run
 * safely next to `applyAnimePartial`/`upsertAnime`'s writers (design.md Decision 1/2). A record
 * id absent from `animes` matches zero rows and throws nothing: the write self-heals on that
 * anime's next confirmed write (design.md Decision 3).
 */
export async function applyAnimeBridgeToken(
  db: AppDatabase,
  recordId: string,
  bridgeModifiedAt: number,
): Promise<void> {
  await db
    .update(animes)
    .set({ bridgeModifiedAt })
    .where(eq(animes._id, recordId));
}

/**
 * Persists a whole confirmed token batch inside the caller's already-open write door -- it never
 * opens its own transaction. Sequential by design: every write targets the same `animes` table
 * on one connection, so parallelizing risks interleaving native SQLite statements on one handle.
 */
export async function persistConfirmedAnimeTokens(
  db: AppDatabase,
  tokens: readonly ConfirmedAnimeToken[],
): Promise<void> {
  for (const token of tokens) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: every write shares the caller's already-open write door on one SQLite connection; parallelizing risks interleaving native statements on the same handle.
    await applyAnimeBridgeToken(db, token.animeId, token.bridgeModifiedAt);
  }
}

/**
 * Reads the stored OCC token for the given record ids, projecting ONLY `{ _id, bridgeModifiedAt }`
 * -- this is the only query in the codebase that names `bridge_modified_at` on the read path
 * (design.md Decision 7), mirroring `loadGuardMap`'s (`merge-context.helpers.ts`) shape for the
 * staleness guard. A missing entry in the returned map means the row was not found; a present
 * entry of `null` means the row exists but no token is known yet -- both read as "no known token"
 * at the call site (`?? null`), but only the latter reflects a real row.
 */
export async function readAnimeBridgeTokens(
  db: AppDatabase,
  recordIds: readonly string[],
): Promise<Map<string, number | null>> {
  if (recordIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({ _id: animes._id, bridgeModifiedAt: animes.bridgeModifiedAt })
    .from(animes)
    .where(inArray(animes._id, recordIds));

  return new Map(rows.map((row) => [row._id, row.bridgeModifiedAt]));
}
