import { createDrizzleDb } from '../../infrastructure/db/client';
import { animes, type AnimeRow } from '../../infrastructure/db/schema';
import { AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema';
import type { SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';

export interface AnimeMutationSyncPatch {
  readonly nrocapvisto: number;
  readonly fechaUltCapVisto: number;
  readonly estado?: number;
  readonly fechaEstreno?: number;
  readonly primeravez?: boolean;
}

export interface SerializedMutationOperation {
  readonly operation: 'update';
  readonly payload: string;
}

/**
 * Reads the current persisted anime snapshot before mutating it.
 * This centralizes SQLite row parsing so mutation hooks only coordinate workflow steps.
 */
export async function fetchParsedAnime(
  rawDb: SQLiteDatabase,
  animeId: string,
): Promise<Anime | null> {
  const db = createDrizzleDb(rawDb);
  const [row] = await db
    .select()
    .from(animes)
    .where(eq(animes._id, animeId))
    .limit(1);

  if (!row) {
    return null;
  }

  return AnimeSchema.parse(parseStoredAnimeRow(row));
}

/**
 * Builds the absolute bridge patch for a Cap+ mutation from the latest persisted snapshot.
 * Using final values instead of relative verbs keeps retries idempotent and bridge-friendly.
 */
export function buildCapPlusPatch(
  anime: Anime,
  now: number,
): AnimeMutationSyncPatch {
  const newCap = anime.nrocapvisto + 1;
  const isFinished =
    anime.totalcap != null && anime.totalcap > 0 && newCap === anime.totalcap;

  return {
    nrocapvisto: newCap,
    fechaUltCapVisto: now,
    ...(anime.primeravez === 1 ? { fechaEstreno: now, primeravez: false } : {}),
    ...(isFinished ? { estado: 1 } : {}),
  };
}

/**
 * Builds the absolute bridge patch for a Cap- mutation from the latest persisted snapshot.
 * This prevents overlapping taps from reusing stale chapter counts.
 */
export function buildCapMinusPatch(
  anime: Anime,
  now: number,
): AnimeMutationSyncPatch {
  return {
    nrocapvisto: Math.max(0, anime.nrocapvisto - 1),
    fechaUltCapVisto: now,
  };
}

/**
 * Converts a bridge-facing patch into the SQLite row shape used by the local anime table.
 * The mapping keeps local integer flags aligned with remote boolean semantics.
 */
export function toLocalAnimeUpdate(patch: AnimeMutationSyncPatch) {
  return {
    nrocapvisto: patch.nrocapvisto,
    fechaUltCapVisto: patch.fechaUltCapVisto,
    ...(patch.estado !== undefined ? { estado: patch.estado } : {}),
    ...(patch.fechaEstreno !== undefined ? { fechaEstreno: patch.fechaEstreno } : {}),
    ...(patch.primeravez !== undefined ? { primeravez: patch.primeravez ? 1 : 0 } : {}),
  };
}

/**
 * Serializes a local mutation as the patch-based reconcile contract expected by the bridge.
 * This removes app-specific operations like `cap_plus` from the outbox payloads.
 */
export function serializeMutationOperation(
  patch: AnimeMutationSyncPatch,
): SerializedMutationOperation {
  return {
    operation: 'update',
    payload: JSON.stringify(patch),
  };
}

function parseStoredAnimeRow(row: AnimeRow) {
  return {
    ...row,
    dias: typeof row.dias === 'string' ? JSON.parse(row.dias) : (row.dias ?? []),
    generos:
      typeof row.generos === 'string'
        ? JSON.parse(row.generos)
        : (row.generos ?? []),
  };
}
