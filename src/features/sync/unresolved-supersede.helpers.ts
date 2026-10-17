import type { SQLiteDatabase } from 'expo-sqlite';
import { ANIME_UPDATE_OPERATION, SEASON_RATING_OPERATION } from './outbox-operation.constants';
import { parseSeasonRatingPayload } from './season-rating-event.helpers';
import { GIVEN_UP_OPERATION_STATUSES, UNRESOLVED_LOG_TAG } from './unresolved-key.constants';
import type {
  AutomaticResolution,
  ConfirmedOperation,
  UnresolvedOperationRow,
  UnresolvedRatingRow,
} from './unresolved-key.types';

/** `?, ?` for every value of `values`, for an SQL `IN (...)` list. */
function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

/**
 * Resolves, inside the caller's open write door, every unresolved anime key that a row this
 * transaction confirms supersedes (ADR 009 R-16b): every event is an absolute `update`, so a later
 * local edit the bridge confirmed carries the key past each edit given up before it. Those given-up
 * `update` rows (`dead_letter`, `conflict_exhausted`, queued before the confirmed row) are deleted;
 * a given-up rating of the same anime is another key and stays. Returns
 * what was resolved, for {@link logAutomaticResolutions} to report once the transaction commits.
 */
export async function resolveSupersededOperations(
  tx: SQLiteDatabase,
  confirmed: readonly ConfirmedOperation[],
): Promise<AutomaticResolution[]> {
  const resolutions: AutomaticResolution[] = [];

  for (const operation of confirmed) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: every statement shares the caller's one write-door transaction.
    const rows = await tx.getAllAsync<{ id: number; status: string; unresolved_reason: string | null }>(
      [
        'SELECT id, status, unresolved_reason FROM operation_log',
        `WHERE anime_id = ? AND id < ? AND operation = ? AND status IN (${placeholders(GIVEN_UP_OPERATION_STATUSES)})`,
        'ORDER BY id',
      ].join(' '),
      operation.animeId,
      operation.id,
      ANIME_UPDATE_OPERATION,
      ...GIVEN_UP_OPERATION_STATUSES,
    );

    if (rows.length > 0) {
      const ids = rows.map((row) => row.id);
      await tx.runAsync(`DELETE FROM operation_log WHERE id IN (${placeholders(ids)})`, ...ids);
      resolutions.push({
        key: { kind: 'anime', animeId: operation.animeId },
        reason: `superseded by confirmed operation ${operation.id}`,
        rows: rows.map((row): UnresolvedOperationRow => ({
          id: row.id,
          status: row.status,
          unresolvedReason: row.unresolved_reason,
        })),
      });
    }
  }

  return resolutions;
}

/**
 * Resolves, inside the caller's open write door, the unresolved rating key a delivered rating
 * supersedes (ADR 009 R-16b, L28): the `season_rating` rows of the same anime and season given up
 * (`dead_letter`) before it are deleted. The season lives in the payload and is compared here, not
 * in SQL, so no JSON1 support is assumed (mirrors the Kotlin `resolveSupersededRatings`).
 */
export async function resolveSupersededRatings(
  tx: SQLiteDatabase,
  confirmed: { readonly id: number; readonly animeId: string; readonly payload: string },
): Promise<AutomaticResolution[]> {
  const seasonId = parseSeasonRatingPayload(confirmed.payload).seasonId;
  const candidates = await tx.getAllAsync<{ id: number; payload: string; unresolved_reason: string | null }>(
    [
      'SELECT id, payload, unresolved_reason FROM operation_log',
      "WHERE anime_id = ? AND id < ? AND operation = ? AND status = 'dead_letter'",
      'ORDER BY id',
    ].join(' '),
    confirmed.animeId,
    confirmed.id,
    SEASON_RATING_OPERATION,
  );
  const rows = candidates.filter((row) => parseSeasonRatingPayload(row.payload).seasonId === seasonId);

  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  await tx.runAsync(`DELETE FROM operation_log WHERE id IN (${placeholders(ids)})`, ...ids);

  return [
    {
      key: { kind: 'season_rating', seasonId: String(seasonId), animeId: confirmed.animeId },
      reason: `superseded by confirmed rating ${confirmed.id}`,
      rows: rows.map((row): UnresolvedRatingRow => ({ id: row.id, unresolvedReason: row.unresolved_reason })),
    },
  ];
}

/**
 * Logs every automatic resolution with its key, the given-up rows and the reason (L18: a
 * deterministic resolution is still explained, never hidden). Called only after the transaction
 * that resolved them committed, so the log never reports a resolution that rolled back.
 */
export function logAutomaticResolutions(resolutions: readonly AutomaticResolution[]): void {
  for (const resolution of resolutions) {
    console.info(`${UNRESOLVED_LOG_TAG} resolved automatically`, resolution);
  }
}
