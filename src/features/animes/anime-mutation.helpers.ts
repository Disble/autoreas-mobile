import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AnimeRow } from '../../infrastructure/db/schema';
import { parseStoredEpisodeLengths } from '../../infrastructure/validation/anime-schema/anime-episodes.helpers';
import { parseStoredAnimeSeason } from '../../infrastructure/validation/anime-schema/anime-season.helpers';
import { AnimeSchema, type Anime } from '../../infrastructure/validation/anime-schema/anime.schema';
import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  AnimeMutationPatchBuilder,
  AnimeMutationSyncPatch,
  SerializedMutationOperation,
} from './anime-mutation.types';
import { invalidateSyncConnectionOnline } from '../sync/sync-connection-store/sync-connection-store.helpers';
import { requestFlush } from '../sync/sync-flush.helpers';
import { recordSyncAttemptFailed } from '../sync/sync-runtime-status.helpers';
import { logLocalWriteFailureDiagnostics } from './anime-mutation-failure.helpers';
import {
  recordChapterActionCommitted,
  recordChapterActionSync,
} from './chapter-action-diagnostics.helpers';
import type { ChapterActionContext } from './chapter-action-diagnostics.types';
import {
  ANIME_ROW_SELECT_SQL,
  INSERT_OPERATION_SQL,
  UPDATE_COLUMN_BY_FIELD,
} from './anime-mutation.constants';

/** The local row fields a mutation patch can write (see `toLocalAnimeUpdate`). */
type AnimeLocalUpdate = ReturnType<typeof toLocalAnimeUpdate>;

/**
 * Builds the parameterized `UPDATE` for exactly the columns one patch carries. Indexing the closed
 * column map with the patch's own field keys is what keeps the two in step: a field the patch can
 * emit but the map does not name cannot compile.
 */
function buildAnimeUpdateSql(fields: readonly (keyof AnimeLocalUpdate)[]): string {
  const assignments = fields.map((field) => `${UPDATE_COLUMN_BY_FIELD[field]} = ?`).join(', ');

  return `UPDATE animes SET ${assignments} WHERE _id = ?`;
}

/**
 * Reads the current persisted anime snapshot before mutating it.
 * This centralizes SQLite row parsing so mutation hooks only coordinate workflow steps.
 *
 * The read goes through the connection's asynchronous `getFirstAsync`, which expo's Android
 * binding dispatches on `Dispatchers.IO`; the previous drizzle statement prepared and executed
 * synchronously on the JS thread.
 */
async function fetchParsedAnime(
  tx: SQLiteDatabase,
  animeId: string,
): Promise<Anime | null> {
  const row = await tx.getFirstAsync<AnimeRow>(ANIME_ROW_SELECT_SQL, animeId);

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
 *
 * The patch carries nothing but `status`, because a manual status change must not move watched
 * chapters, the last-viewed date or the first-cycle metadata. Those fields belong to the chapter
 * builders, which keep their own auto-completion and auto-reopening rules.
 */
export function buildSetEstadoPatch(estado: number): AnimeMutationSyncPatch {
  return { status: estado };
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
 * The mapping keeps local integer flags aligned with remote boolean semantics, and writes only the
 * fields the patch actually carries: a patch without `episodesWatched` or `lastWatchedAt` leaves the
 * stored chapter count and viewing date untouched.
 */
export function toLocalAnimeUpdate(patch: AnimeMutationSyncPatch) {
  const localUpdate: {
    nrocapvisto?: number;
    fechaUltCapVisto?: number;
    estado?: number;
    fechaEstreno?: number;
    primeravez?: 0 | 1;
  } = {};

  if (patch.episodesWatched !== undefined) {
    localUpdate.nrocapvisto = patch.episodesWatched;
  }

  if (patch.lastWatchedAt !== undefined) {
    localUpdate.fechaUltCapVisto = patch.lastWatchedAt;
  }

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
 * Records a failed local mutation: its write-failure diagnostics go to the console, and the
 * attempt is persisted into the shared runtime status.
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
  logLocalWriteFailureDiagnostics(label, error);

  try {
    await recordSyncAttemptFailed(rawDb, Date.now());
  } catch (telemetryError) {
    console.warn(`[${label}] Failed to persist mutation failure telemetry`, telemetryError);
  }
}

/**
 * Runs a patch-based mutation inside a queued deferred SQLite transaction and enqueues the sync operation.
 * Centralizing this orchestration keeps `useMutateAnime` focused on wiring React callbacks to
 * the builders, and removes duplication between cap+, cap-, and state-change flows.
 *
 * Every statement here goes through the transaction connection's asynchronous API
 * (`getFirstAsync` / `runAsync`), which expo's Android binding runs on `Dispatchers.IO`. The
 * statements the drizzle expo driver issued here before were prepared and executed synchronously,
 * so a slow write held the JS thread even though the caller awaited it. The transaction itself is
 * unchanged: `withLocalWrite` still owns `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` on the same
 * file-keyed door, and the read, the update and the outbox insert keep their order.
 *
 * Returns whether a row was actually updated, because the two cases are indistinguishable from the
 * outside otherwise: an absent row resolves normally and leaves the list untouched, which reads
 * exactly like a committed write with no visible effect. `actionContext` is optional and additive --
 * the season-rating and estado flows pass none, and instrumenting them is not this parameter's job.
 */
export async function applyAnimeMutationPatch(
  rawDb: SQLiteDatabase,
  animeId: string,
  buildPatch: AnimeMutationPatchBuilder,
  label: string,
  actionContext?: ChapterActionContext,
): Promise<boolean> {
  const now = Date.now();
  let didMutate = false;

  // `tx` is the only handle this path touches. The callback's first argument is the drizzle query
  // builder other consumers of the write door use; nothing here reads through it any more.
  await withLocalWrite(rawDb, async (_db, tx) => {
    const anime = await fetchParsedAnime(tx, animeId);
    if (!anime) return;

    const bridgePatch = buildPatch(anime, now);
    const operation = serializeMutationOperation(bridgePatch);
    const localUpdate = toLocalAnimeUpdate(bridgePatch);
    const fields = Object.keys(localUpdate) as (keyof AnimeLocalUpdate)[];

    await tx.runAsync(
      buildAnimeUpdateSql(fields),
      ...fields.map((field) => localUpdate[field] as number),
      anime._id,
    );

    await tx.runAsync(
      INSERT_OPERATION_SQL,
      anime._id,
      operation.operation,
      operation.payload,
      'pending',
      now,
    );

    didMutate = true;
  });

  if (!didMutate) return false;

  if (actionContext) {
    recordChapterActionCommitted(actionContext);
  }

  // New durable work: online truth no longer holds until a cycle reads it. Then the one entry
  // point (ADR 009 R-2, I2) runs the coordinated cycle, which drains every kind, records its
  // attempt and publishes the connection outcome; this kick only reports the chapter's push.
  invalidateSyncConnectionOnline();
  void requestFlush(rawDb, 'local_mutation')
    .then(() => {
      if (actionContext) {
        recordChapterActionSync(actionContext, 'ok');
      }
    })
    .catch((err: unknown) => {
      // Recorded here, not at the promise's rejection site: this branch IS where the push's
      // outcome becomes known, and the chapter feed must report it while the local write stays
      // reported as committed.
      if (actionContext) {
        recordChapterActionSync(actionContext, 'failed');
      }

      console.warn(`[${label}] Sync failed:`, err);
    });

  return true;
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
 * `episodes` and `season` are JSON text too; an unreadable value reads as none.
 */
function parseStoredAnimeRow(row: AnimeRow) {
  return {
    ...row,
    dias: typeof row.dias === 'string' ? parseStoredJson(row.dias) : (row.dias ?? []),
    generos:
      typeof row.generos === 'string'
        ? parseStoredJson(row.generos)
        : (row.generos ?? []),
    episodes: parseStoredEpisodeLengths(row.episodes),
    season: parseStoredAnimeSeason(row.season),
  };
}
