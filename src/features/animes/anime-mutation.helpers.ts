import { createDrizzleDb, withDeferredWrite } from '../../infrastructure/db/client';
import { animes, operationLog, type AnimeRow } from '../../infrastructure/db/schema';
import { AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema';
import type { SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import { syncPendingOperations } from '../sync/reconcile.helpers';

export type AnimeMutationPatchBuilder = (anime: Anime, now: number) => AnimeMutationSyncPatch;

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
  const nextCap = Math.max(0, anime.nrocapvisto - 1);
  const shouldReopenCompletedAnime =
    anime.estado === 1 &&
    anime.totalcap != null &&
    anime.totalcap > 0 &&
    anime.nrocapvisto === anime.totalcap;

  return {
    nrocapvisto: nextCap,
    fechaUltCapVisto: now,
    ...(shouldReopenCompletedAnime ? { estado: 0 } : {}),
  };
}

/**
 * Builds the absolute bridge patch for changing only the `estado` (Viendo/Finalizado/etc).
 * When transitioning to Finalizado and a `totalcap` exists, snaps `nrocapvisto` to the total
 * so progress and completion stay consistent in a single idempotent payload.
 */
export function buildSetEstadoPatch(
  anime: Anime,
  estado: number,
  now: number,
): AnimeMutationSyncPatch {
  const shouldSnapToTotal =
    estado === 1 && anime.totalcap != null && anime.totalcap > 0;

  return {
    nrocapvisto: shouldSnapToTotal ? (anime.totalcap as number) : anime.nrocapvisto,
    fechaUltCapVisto: now,
    estado,
  };
}

/**
 * Builds the absolute bridge patch for incrementing watched chapters by half a unit.
 * Uses fractional `nrocapvisto` to mirror the legacy desktop "+0.5" gesture and
 * autofinalizes when the half-step reaches the total.
 */
export function buildCapPlusHalfPatch(
  anime: Anime,
  now: number,
): AnimeMutationSyncPatch {
  const newCap = anime.nrocapvisto + 0.5;
  const isFinished =
    anime.totalcap != null && anime.totalcap > 0 && newCap >= anime.totalcap;

  return {
    nrocapvisto: isFinished ? (anime.totalcap as number) : newCap,
    fechaUltCapVisto: now,
    ...(isFinished ? { estado: 1 } : {}),
  };
}

/**
 * Builds the absolute bridge patch for decrementing watched chapters by half a unit.
 * Mirrors `buildCapMinusPatch` but with a 0.5 step, including the auto-reopen rule when
 * the anime was previously snapped to Finalizado at totalcap.
 */
export function buildCapMinusHalfPatch(
  anime: Anime,
  now: number,
): AnimeMutationSyncPatch {
  const nextCap = Math.max(0, anime.nrocapvisto - 0.5);
  const shouldReopenCompletedAnime =
    anime.estado === 1 &&
    anime.totalcap != null &&
    anime.totalcap > 0 &&
    anime.nrocapvisto === anime.totalcap;

  return {
    nrocapvisto: nextCap,
    fechaUltCapVisto: now,
    ...(shouldReopenCompletedAnime ? { estado: 0 } : {}),
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

/**
 * Runs a patch-based mutation inside a queued deferred SQLite transaction and enqueues the sync operation.
 * Centralizing this orchestration keeps `useMutateAnime` focused on wiring React callbacks to
 * the builders, and removes duplication between cap+, cap-, and state-change flows.
 */
export async function applyAnimeMutationPatch(
  rawDb: SQLiteDatabase,
  animeId: string,
  buildPatch: AnimeMutationPatchBuilder,
  label: string,
): Promise<void> {
  const now = Date.now();
  let didMutate = false;

  await withDeferredWrite(rawDb, async (txDb, tx) => {
    const anime = await fetchParsedAnime(tx, animeId);
    if (!anime) return;

    const bridgePatch = buildPatch(anime, now);
    const operation = serializeMutationOperation(bridgePatch);

    await txDb
      .update(animes)
      .set(toLocalAnimeUpdate(bridgePatch))
      .where(eq(animes._id, anime._id));

    await txDb.insert(operationLog).values({
      animeId: anime._id,
      operation: operation.operation,
      payload: operation.payload,
      status: 'pending',
      createdAt: now,
    });

    didMutate = true;
  });

  if (!didMutate) return;

  // Sincroniza en background — no bloquea la UI
  void syncPendingOperations(rawDb).catch((err: unknown) => {
    console.warn(`[${label}] Sync failed:`, err);
  });
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
