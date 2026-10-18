import type { PostActiveSeasonRatingRequest } from '../../infrastructure/api';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { SEASON_RATING_OPERATION } from './outbox-operation.constants';
import type {
  SeasonRatingFailureKind,
  SeasonRatingFate,
  SeasonRatingIntent,
  SeasonRatingIntentStatus,
  SeasonRatingPayload,
} from './season-rating-event.types';

/**
 * Parses a stored rating payload. Anything that is not a JSON object reads as `{}`, like
 * `parseOperationPayload` and the Kotlin `parseSeasonRatingPayload`.
 */
export function parseSeasonRatingPayload(payload: string | null): SeasonRatingPayload {
  try {
    const parsed: unknown = JSON.parse(payload ?? '');

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SeasonRatingPayload) : {};
  } catch {
    return {};
  }
}

/**
 * Builds the bridge request for one rating row. A field the payload does not carry stays
 * `undefined`, so the JSON body omits it, never guesses it: the bridge then rejects the message
 * (422), the 4xx fate any rejected message has. The queued season travels as `season_id`, so a
 * rating for a season the bridge has since closed or replaced is refused (404) instead of landing in
 * the new one (L11). Same body as the Kotlin `buildSeasonRatingBody`.
 */
export function buildSeasonRatingRequest(row: Pick<OperationLogRow, 'animeId' | 'payload'>): PostActiveSeasonRatingRequest {
  const payload = parseSeasonRatingPayload(row.payload);

  return {
    animeId: row.animeId,
    nota: payload.grade as number,
    ratedAt: payload.ratedAt as number,
    seasonId: payload.seasonId as string,
  };
}

/**
 * Classifies one rating answer into its single fate (ADR 009 R-5), the same in both runtimes:
 * only a 204 is a delivery; a 401, 404, 409 or any other 4xx is a rejection kept as unresolved;
 * anything else (no answer, a 5xx, another status) is retried.
 */
export function classifySeasonRatingAnswer(status: number | null): SeasonRatingFate {
  if (status === 204) {
    return { kind: 'delivered' };
  }

  const reason = rejectionReason(status);

  return reason ? { kind: 'given_up', reason } : { kind: 'pending' };
}

/** The unresolved reason of a rejecting status, or `null` when `status` is not a 4xx. */
function rejectionReason(status: number | null): SeasonRatingFailureKind | null {
  if (status === null || status < 400 || status > 499) {
    return null;
  }

  const named: Readonly<Record<number, SeasonRatingFailureKind>> = { 401: 'auth_repair', 404: 'not_found', 409: 'conflict' };

  return named[status] ?? 'rejected';
}

/** The status a queued row shows in the season projection, or `null` for a confirmed one. */
function intentStatus(status: string): SeasonRatingIntentStatus | null {
  const shown: Readonly<Record<string, SeasonRatingIntentStatus>> = {
    pending: 'pending',
    processing: 'syncing',
    dead_letter: 'failed',
  };

  return shown[status] ?? null;
}

/**
 * Maps the `season_rating` rows of the outbox to the local intents the season projection shows:
 * waiting, in flight, or given up with its reason. A confirmed (`synced`) rating shows the
 * bridge's value instead, so it maps to nothing.
 */
export function mapSeasonRatingIntents(rows: readonly OperationLogRow[]): SeasonRatingIntent[] {
  return rows.flatMap((row) => {
    const status = intentStatus(row.status);

    if (row.operation !== SEASON_RATING_OPERATION || status === null) {
      return [];
    }

    const payload = parseSeasonRatingPayload(row.payload);

    return [{
      id: row.id,
      animeId: row.animeId,
      seasonId: String(payload.seasonId),
      nota: Number(payload.grade),
      ratedAt: Number(payload.ratedAt),
      createdAt: row.createdAt,
      status,
      failureKind: status === 'failed' ? (row.unresolvedReason as SeasonRatingFailureKind | null) : null,
    }];
  });
}
