import type { SQLiteDatabase } from 'expo-sqlite';
import { and, eq, inArray } from 'drizzle-orm';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { operationLog } from '../../infrastructure/db/schema';
import { SEASON_RATING_OPERATION } from './outbox-operation.constants';
import { DEFAULT_SEASON_RATING_CLOCK } from './season-rating-event.constants';
import type { SeasonRatingClock, SeasonRatingIntentInput, SeasonRatingPayload } from './season-rating-event.types';
import { invalidateSyncConnectionOnline } from './sync-connection-store/sync-connection-store.helpers';
import { requestFlush } from './sync-flush.helpers';

/**
 * Queues one season rating in the anime outbox (ADR 009 R-1, R-2; L20, L28): a `season_rating`
 * row of its anime, written durably through the write door before any delivery, so a rating made
 * offline is never lost. Then it asks the one entry point for a flush (I1), so a rating made while
 * the bridge is reachable leaves without waiting for another trigger; the flush outcome is the
 * dispatched cycle's to publish.
 */
export async function enqueueSeasonRatingIntent(
  rawDb: SQLiteDatabase,
  input: SeasonRatingIntentInput,
  clock: SeasonRatingClock = DEFAULT_SEASON_RATING_CLOCK,
): Promise<void> {
  const payload: SeasonRatingPayload = { seasonId: input.seasonId, grade: input.nota, ratedAt: input.ratedAt };

  await withLocalWrite(rawDb, async (db) => {
    await db.insert(operationLog).values({
      animeId: input.animeId,
      operation: SEASON_RATING_OPERATION,
      payload: JSON.stringify(payload),
      status: 'pending',
      createdAt: clock.now(),
    });
  });

  invalidateSyncConnectionOnline();
  void requestFlush(rawDb, 'season_rating').catch(() => undefined);
}

/**
 * Builds the live query for the `season_rating` rows the season projection shows (L28): waiting,
 * in flight, or given up. A confirmed (`synced`) rating is left to the bridge's own value. The
 * rows are mapped to intents with `mapSeasonRatingIntents`.
 */
export function buildSeasonRatingIntentsQuery(db: AppDatabase) {
  return db
    .select()
    .from(operationLog)
    .where(
      and(
        eq(operationLog.operation, SEASON_RATING_OPERATION),
        inArray(operationLog.status, ['pending', 'processing', 'dead_letter']),
      ),
    );
}
