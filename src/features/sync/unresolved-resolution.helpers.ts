import { eq } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../infrastructure/api';
import type { BridgeHttpResult } from '../../infrastructure/api';
import { getBridgeConfigSnapshot, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { animes } from '../../infrastructure/db/schema';
import type { IngestedAnime } from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import { mapWireAnimeToIngestedAnime } from '../../infrastructure/validation/anime-schema/anime-wire.helpers';
import { WireAnimeSchema } from '../../infrastructure/validation/anime-schema/anime.schema';
import { healAnimeFromSnapshot } from './full-resync.helpers';
import { applyRemoteChanges } from './merge/apply-remote-changes.helpers';
import { liveClaimFloor } from './outbox-claim.helpers';
import {
  GIVEN_UP_OPERATION_STATUSES,
  UNRESOLVED_RATING_FAILURE_KINDS,
  UNRESOLVED_RESOLUTION_ERROR_CODE,
} from './unresolved-key.constants';
import { UnresolvedResolutionError } from './unresolved-key.errors';
import type { UnresolvedKey, UnresolvedKeyRef } from './unresolved-key.types';

/** An unresolved anime key. */
type AnimeKey = Extract<UnresolvedKey, { kind: 'anime' }>;

/** An unresolved rating key. */
type RatingKey = Extract<UnresolvedKey, { kind: 'season_rating' }>;

/** What the bridge holds for an anime: nothing (404), or the anime with its token. */
type RemoteAnimeState = { readonly kind: 'deleted' } | { readonly kind: 'anime'; readonly ingested: IngestedAnime };

/** `?, ?` for every value of `values`, for an SQL `IN (...)` list. */
function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

/** The ref of `key`, without its rows and choices: what an error names. */
function refOf(key: UnresolvedKey): UnresolvedKeyRef {
  return key.kind === 'anime'
    ? { kind: 'anime', animeId: key.animeId }
    : { kind: 'season_rating', seasonId: key.seasonId, animeId: key.animeId };
}

/** True while the key's queue holds a live claim (ADR 009 R-13): the other runtime owns it now. */
async function isKeyClaimed(tx: SQLiteDatabase, key: UnresolvedKey): Promise<boolean> {
  const floor = liveClaimFloor(Date.now());
  const claimed = key.kind === 'anime'
    ? await tx.getFirstAsync('SELECT 1 FROM operation_log WHERE anime_id = ? AND claimed_at > ? LIMIT 1', key.animeId, floor)
    : await tx.getFirstAsync('SELECT 1 FROM season_rating_queue WHERE season_id = ? AND claimed_at > ? LIMIT 1', key.seasonId, floor);

  return claimed !== null;
}

/**
 * Runs `write` in one write-door transaction unless the key holds a live claim, checked inside the
 * same transaction; a claimed key is refused with nothing written.
 */
async function writeUnclaimedKey(
  rawDb: SQLiteDatabase,
  key: UnresolvedKey,
  write: (db: AppDatabase, tx: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  const written = await withLocalWrite(rawDb, async (db, tx) => {
    if (await isKeyClaimed(tx, key)) {
      return false;
    }

    await write(db, tx);
    return true;
  });

  if (!written) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.keyClaimed, refOf(key));
  }
}

/**
 * Keep local for an anime key: its given-up rows go back to `pending` with a fresh conflict count
 * and no reason, and the anime's token is cleared, so the next cycle fetches a fresh base first
 * (ADR 009 R-3) and re-chains the key from it.
 */
export async function keepLocalForAnime(rawDb: SQLiteDatabase, key: AnimeKey): Promise<void> {
  await writeUnclaimedKey(rawDb, key, async (_db, tx) => {
    await tx.runAsync(
      [
        "UPDATE operation_log SET status = 'pending', unresolved_reason = NULL, conflict_attempt_count = 0",
        `WHERE anime_id = ? AND status IN (${placeholders(GIVEN_UP_OPERATION_STATUSES)})`,
      ].join(' '),
      key.animeId,
      ...GIVEN_UP_OPERATION_STATUSES,
    );
    await tx.runAsync('UPDATE animes SET bridge_modified_at = NULL WHERE _id = ?', key.animeId);
  });
}

/** Asks the bridge for one anime, mapping a transport failure to the typed refusal. */
async function requestAnime(rawDb: SQLiteDatabase, key: AnimeKey): Promise<BridgeHttpResult> {
  const config = await getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.notPaired, refOf(key));
  }

  try {
    return await bridgeClient.getAnime({ ip: config.ip, port: config.port, token: config.token }, key.animeId);
  } catch {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.bridgeUnreachable, refOf(key));
  }
}

/**
 * Reads what the bridge holds for the key's anime. A 404 is the delete rule's input; any other
 * non-2xx means the bridge could not answer; an anime that does not parse (for instance, with no
 * token) cannot be applied.
 */
async function fetchRemoteAnimeState(rawDb: SQLiteDatabase, key: AnimeKey): Promise<RemoteAnimeState> {
  const result = await requestAnime(rawDb, key);

  if (result.status === 404) {
    return { kind: 'deleted' };
  }

  if (!result.ok) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.bridgeUnreachable, refOf(key));
  }

  const parsed = WireAnimeSchema.safeParse(result.data);

  if (!parsed.success) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.remoteStateUnavailable, refOf(key));
  }

  return { kind: 'anime', ingested: mapWireAnimeToIngestedAnime(parsed.data) };
}

/**
 * Keep bridge for an anime key: every queued row of the key (all but `synced` history) is
 * dropped and the bridge's state is applied in the same transaction. A 404 applies the delete
 * rule through the merge boundary; an anime is written the way the heal writes it, token included.
 */
export async function keepBridgeForAnime(rawDb: SQLiteDatabase, key: AnimeKey): Promise<void> {
  const remote = await fetchRemoteAnimeState(rawDb, key);

  await writeUnclaimedKey(rawDb, key, async (db, tx) => {
    await tx.runAsync("DELETE FROM operation_log WHERE anime_id = ? AND status <> 'synced'", key.animeId);

    if (remote.kind === 'deleted') {
      await applyRemoteChanges(
        db,
        [{ recordId: key.animeId, changeType: 'delete', changedFields: [], timestamp: Date.now() }],
        { guardByRecordId: new Map(), pendingOutboxRecordIds: new Set() },
      );
      return;
    }

    const [localRow] = await db.select().from(animes).where(eq(animes._id, key.animeId)).limit(1);
    await healAnimeFromSnapshot(db, remote.ingested.anime, remote.ingested.bridgeModifiedAt, localRow);
  });
}

/** Keep local for a rating key: its given-up ratings go back to `pending`, to be sent again. */
export async function keepLocalForRating(rawDb: SQLiteDatabase, key: RatingKey): Promise<void> {
  await writeUnclaimedKey(rawDb, key, async (_db, tx) => {
    await tx.runAsync(
      [
        "UPDATE season_rating_queue SET status = 'pending', last_failure_kind = NULL, updated_at = ?",
        "WHERE season_id = ? AND anime_id = ? AND status = 'failed'",
        `AND last_failure_kind IN (${placeholders(UNRESOLVED_RATING_FAILURE_KINDS)})`,
      ].join(' '),
      Date.now(),
      key.seasonId,
      key.animeId,
      ...UNRESOLVED_RATING_FAILURE_KINDS,
    );
  });
}

/**
 * Keep bridge for a rating key: every queued rating of the key is dropped. The bridge's rating is
 * what the active-season snapshot shows (refreshed right after a 404/409, on the next refresh after
 * any other 4xx); with no local intent left, nothing overrides it.
 */
export async function keepBridgeForRating(rawDb: SQLiteDatabase, key: RatingKey): Promise<void> {
  await writeUnclaimedKey(rawDb, key, async (_db, tx) => {
    await tx.runAsync('DELETE FROM season_rating_queue WHERE season_id = ? AND anime_id = ?', key.seasonId, key.animeId);
  });
}
