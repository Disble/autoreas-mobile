import type { SQLiteDatabase } from 'expo-sqlite';
import { ANIME_UPDATE_OPERATION, SEASON_RATING_OPERATION } from './outbox-operation.constants';
import { parseSeasonRatingPayload } from './season-rating-event.helpers';
import {
  BOTH_CHOICES,
  GIVEN_UP_OPERATION_STATUSES,
  KEEP_BRIDGE_ONLY_CHOICES,
  KEEP_BRIDGE_ONLY_OPERATION_REASONS,
  KEEP_BRIDGE_ONLY_RATING_REASON,
  UNRESOLVED_LOG_TAG,
  UNRESOLVED_RESOLUTION_ERROR_CODE,
} from './unresolved-key.constants';
import { UnresolvedResolutionError } from './unresolved-key.errors';
import type {
  UnresolvedChoice,
  UnresolvedKey,
  UnresolvedKeyRef,
  UnresolvedOperationRow,
  UnresolvedRatingRow,
} from './unresolved-key.types';
import {
  keepBridgeForAnime,
  keepBridgeForRating,
  keepLocalForAnime,
  keepLocalForRating,
} from './unresolved-resolution.helpers';

/** One string per key, equal exactly when two refs name the same key. */
function keyIdentity(ref: UnresolvedKeyRef): string {
  return JSON.stringify(ref.kind === 'anime' ? [ref.kind, ref.animeId] : [ref.kind, ref.seasonId, ref.animeId]);
}

/** Appends `row` to the group `key` maps to, opening the group on its first row. */
function addToGroup<Row>(groups: Map<string, Row[]>, key: string, row: Row): void {
  const group = groups.get(key) ?? [];
  group.push(row);
  groups.set(key, group);
}

/** Reads the unresolved anime keys: every anime with a given-up `update` row. */
async function readUnresolvedAnimeKeys(rawDb: SQLiteDatabase): Promise<UnresolvedKey[]> {
  const rows = await rawDb.getAllAsync<{ id: number; anime_id: string; status: string; unresolved_reason: string | null }>(
    [
      'SELECT id, anime_id, status, unresolved_reason FROM operation_log',
      `WHERE operation = ? AND status IN (${GIVEN_UP_OPERATION_STATUSES.map(() => '?').join(', ')})`,
      'ORDER BY id',
    ].join(' '),
    ANIME_UPDATE_OPERATION,
    ...GIVEN_UP_OPERATION_STATUSES,
  );
  const groups = new Map<string, UnresolvedOperationRow[]>();
  for (const row of rows) {
    addToGroup(groups, row.anime_id, { id: row.id, status: row.status, unresolvedReason: row.unresolved_reason });
  }

  return [...groups].map(([animeId, keyRows]) => ({
    kind: 'anime',
    animeId,
    rows: keyRows,
    offeredChoices: keyRows.some((row) => KEEP_BRIDGE_ONLY_OPERATION_REASONS.includes(row.unresolvedReason ?? ''))
      ? KEEP_BRIDGE_ONLY_CHOICES
      : BOTH_CHOICES,
  }));
}

/**
 * Reads the unresolved rating keys (L28): every anime and season with a `season_rating` row the
 * bridge refused (`dead_letter`). The season lives in the payload and is grouped here, not in SQL,
 * so no JSON1 support is assumed.
 */
async function readUnresolvedRatingKeys(rawDb: SQLiteDatabase): Promise<UnresolvedKey[]> {
  const rows = await rawDb.getAllAsync<{ id: number; anime_id: string; payload: string; unresolved_reason: string | null }>(
    "SELECT id, anime_id, payload, unresolved_reason FROM operation_log WHERE operation = ? AND status = 'dead_letter' ORDER BY id",
    SEASON_RATING_OPERATION,
  );
  const groups = new Map<string, { seasonId: string; animeId: string; rows: UnresolvedRatingRow[] }>();
  for (const row of rows) {
    const seasonId = String(parseSeasonRatingPayload(row.payload).seasonId);
    const groupKey = keyIdentity({ kind: 'season_rating', seasonId, animeId: row.anime_id });
    const group = groups.get(groupKey) ?? { seasonId, animeId: row.anime_id, rows: [] };
    group.rows.push({ id: row.id, unresolvedReason: row.unresolved_reason });
    groups.set(groupKey, group);
  }

  return [...groups.values()].map((group) => ({
    kind: 'season_rating',
    ...group,
    offeredChoices: group.rows.some((row) => row.unresolvedReason === KEEP_BRIDGE_ONLY_RATING_REASON)
      ? KEEP_BRIDGE_ONLY_CHOICES
      : BOTH_CHOICES,
  }));
}

/**
 * Lists every unresolved key (ADR 009 R-16b) with the rows that make it unresolved and the
 * choices it offers: anime keys first (by their oldest given-up row), then rating keys. Read live,
 * not from the persisted runtime snapshot, because a key changes outside any sync cycle.
 */
export async function listUnresolvedKeys(rawDb: SQLiteDatabase): Promise<UnresolvedKey[]> {
  return [...(await readUnresolvedAnimeKeys(rawDb)), ...(await readUnresolvedRatingKeys(rawDb))];
}

/** Counts unresolved KEYS, never rows: the status figure ADR 009 R-16b asks for. */
export async function readUnresolvedKeyCount(rawDb: SQLiteDatabase): Promise<number> {
  return (await listUnresolvedKeys(rawDb)).length;
}

/** True when `candidate` is the key `ref` names. */
function isSameKey(candidate: UnresolvedKey, ref: UnresolvedKeyRef): boolean {
  return keyIdentity(candidate) === keyIdentity(ref);
}

/**
 * The one resolution entry point (ADR 009 R-16b). It acts on the whole key:
 * - `keep_local` re-queues the key's given-up rows; an anime key is re-chained from a fresh base
 *   (its token is cleared, so fetch-first asks the bridge for one before the next send), while a
 *   rating key is simply sent again (a rating carries no base);
 * - `keep_bridge` drops the key's queued rows and applies the bridge's state; an anime the bridge
 *   answers 404 for is removed by the delete rule. An anime key and a rating key of the same anime
 *   are separate keys: resolving one never touches the other's rows.
 *
 * A key the bridge has no anime for (404) or returned without a token, and a rating the bridge
 * answered 404, offer only `keep_bridge`. Writes go through the write door and refuse a key the
 * other runtime holds a live claim on (R-13). Every refusal is an `UnresolvedResolutionError`
 * and writes nothing.
 */
export async function resolveUnresolvedKey(
  rawDb: SQLiteDatabase,
  key: UnresolvedKeyRef,
  choice: UnresolvedChoice,
): Promise<void> {
  const unresolved = (await listUnresolvedKeys(rawDb)).find((candidate) => isSameKey(candidate, key));

  if (!unresolved) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.notUnresolved, key);
  }

  if (!unresolved.offeredChoices.includes(choice)) {
    throw new UnresolvedResolutionError(UNRESOLVED_RESOLUTION_ERROR_CODE.choiceNotOffered, key);
  }

  if (unresolved.kind === 'anime') {
    await (choice === 'keep_local' ? keepLocalForAnime : keepBridgeForAnime)(rawDb, unresolved);
  } else {
    await (choice === 'keep_local' ? keepLocalForRating : keepBridgeForRating)(rawDb, unresolved);
  }

  console.info(`${UNRESOLVED_LOG_TAG} resolved by choice`, { key, choice, rows: unresolved.rows });
}
