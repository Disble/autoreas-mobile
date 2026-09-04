import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { animes, operationLog, type AnimeRow } from '../../infrastructure/db/schema';
import { AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema/anime.schema';
import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  AnimeMutationPatchBuilder,
  AnimeMutationSyncPatch,
  SerializedMutationOperation,
} from './anime-mutation.types';
import { eq } from 'drizzle-orm';
import { syncPendingOperations } from '../sync/reconcile.helpers';
import {
  beginSyncConnectionAttempt,
  markSyncConnectionFailed,
  markSyncConnectionPending,
  publishSyncConnectionAttempt,
} from '../sync/sync-connection-store/sync-connection-store.helpers';
import { recordSyncAttemptFailed } from '../sync/sync-runtime-status.helpers';
import { getAnimeMutationFailureMessage } from './anime-mutation-failure.helpers';
import { recordDiagnosticEvent } from '../sync/sync-diagnostic-store/sync-diagnostic-store.helpers';
import { causeFromError } from '../sync/sync-telemetry.helpers';

/**
 * Reads the current persisted anime snapshot before mutating it.
 * This centralizes SQLite row parsing so mutation hooks only coordinate workflow steps.
 */
async function fetchParsedAnime(
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
    episodesWatched: newCap,
    lastWatchedAt: now,
    ...(anime.primeravez === 1 ? { premieredAt: now, firstCycle: false } : {}),
    ...(isFinished ? { status: 1 } : {}),
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
    episodesWatched: nextCap,
    lastWatchedAt: now,
    ...(shouldReopenCompletedAnime ? { status: 0 } : {}),
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
    episodesWatched: shouldSnapToTotal ? (anime.totalcap as number) : anime.nrocapvisto,
    lastWatchedAt: now,
    status: estado,
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
    episodesWatched: isFinished ? (anime.totalcap as number) : newCap,
    lastWatchedAt: now,
    ...(isFinished ? { status: 1 } : {}),
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
    episodesWatched: nextCap,
    lastWatchedAt: now,
    ...(shouldReopenCompletedAnime ? { status: 0 } : {}),
  };
}

/**
 * Converts a bridge-facing patch into the SQLite row shape used by the local anime table.
 * The mapping keeps local integer flags aligned with remote boolean semantics.
 */
export function toLocalAnimeUpdate(patch: AnimeMutationSyncPatch) {
  const localUpdate: {
    nrocapvisto: number;
    fechaUltCapVisto: number;
    estado?: number;
    fechaEstreno?: number;
    primeravez?: 0 | 1;
  } = {
    nrocapvisto: patch.episodesWatched,
    fechaUltCapVisto: patch.lastWatchedAt,
  };

  if (patch.status !== undefined) {
    localUpdate.estado = patch.status;
  }

  if (patch.premieredAt !== undefined) {
    localUpdate.fechaEstreno = patch.premieredAt;
  }

  if (patch.firstCycle !== undefined) {
    localUpdate.primeravez = patch.firstCycle ? 1 : 0;
  }

  return localUpdate;
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
 * Persists a failed local mutation into the shared runtime status so Settings can show it.
 *
 * This exists because a rejected chapter mutation used to vanish: the list screen fires the
 * mutation through `void handleCapPlus(...)`, so the rejection became an unhandled promise and
 * the button simply appeared dead with nothing recorded anywhere.
 *
 * Telemetry failures are swallowed on purpose. The most likely cause of a mutation failure is the
 * database being unwritable, in which case this write fails too — and it must never replace the
 * original error the caller is about to see.
 */
export async function recordAnimeMutationFailure(
  rawDb: SQLiteDatabase,
  label: string,
  error: unknown,
): Promise<void> {
  // Emitted BEFORE the persisted write, because that write is exactly what fails when the
  // database is unwritable -- which is the case this event most needs to report. The ring is
  // in memory, so it survives the very failure that swallows the durable record.
  recordDiagnosticEvent({
    source: 'mutation',
    event: 'mutation_failed',
    cause: causeFromError(error),
    at: Date.now(),
  });

  try {
    await recordSyncAttemptFailed(
      rawDb,
      'local_mutation_write',
      Date.now(),
      getAnimeMutationFailureMessage(label, error),
    );
  } catch (telemetryError) {
    console.warn(`[${label}] Failed to persist mutation failure telemetry`, telemetryError);
  }
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

  await withLocalWrite(rawDb, async (txDb, tx) => {
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

  const syncAttempt = beginSyncConnectionAttempt();

  // Sincroniza en background — no bloquea la UI
  void syncPendingOperations(rawDb)
    .then(() => {
      markSyncConnectionPending(syncAttempt);
    })
    .catch(async (err: unknown) => {
      const failure = err instanceof Error ? err : new Error('Sync failed');

      // Distinct from `mutation_failed`: the local write LANDED and only the push to the bridge
      // failed. Same symptom for the user, opposite diagnosis, and today the two are
      // indistinguishable from anywhere but the device.
      recordDiagnosticEvent({
        source: 'mutation',
        event: 'mutation_sync_failed',
        cause: causeFromError(failure),
        at: Date.now(),
      });

      await publishSyncConnectionAttempt({
        attempt: syncAttempt,
        persistTelemetry: async () => {
          try {
            await recordSyncAttemptFailed(
              rawDb,
              'local_mutation',
              Date.now(),
              failure.message,
            );
          } catch (telemetryError) {
            console.warn(`[${label}] Failed to persist sync failure telemetry`, telemetryError);
          }
        },
        publishConnection: () => markSyncConnectionFailed(syncAttempt, failure),
      });
      console.warn(`[${label}] Sync failed:`, err);
    });
}

/**
 * Parses one JSON column back into a value, returning `unknown` so the caller must narrow it.
 * The cast is deliberate: `JSON.parse` claims `any`, which would silently disable type checking
 * for everything downstream of a stored column.
 */
function parseStoredJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

/**
 * Rehydrates a raw SQLite row into the shape `AnimeSchema` validates.
 * `dias` and `generos` are stored as JSON text but were written as arrays by older versions, so
 * each is parsed only when it is still a string and falls back to an empty array otherwise.
 */
function parseStoredAnimeRow(row: AnimeRow) {
  return {
    ...row,
    dias: typeof row.dias === 'string' ? parseStoredJson(row.dias) : (row.dias ?? []),
    generos:
      typeof row.generos === 'string'
        ? parseStoredJson(row.generos)
        : (row.generos ?? []),
  };
}
