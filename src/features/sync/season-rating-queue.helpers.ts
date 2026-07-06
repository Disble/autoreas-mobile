import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, BridgeUnreachableError } from '../../infrastructure/api';
import { getBridgeConfigSnapshot, withDeferredWrite } from '../../infrastructure/db/client';
import { seasonRatingQueue } from '../../infrastructure/db/schema';
import type {
  CreateSeasonRatingQueueEntryInput,
  DrainSeasonRatingQueueResult,
  ResolveSeasonRatingDeliveryInput,
  SeasonRatingDeliveryResolution,
  SeasonRatingQueueClock,
  SeasonRatingQueueEntry,
} from './season-rating-queue.types';

const defaultQueueClock: SeasonRatingQueueClock = {
  now: () => Date.now(),
};

/**
 * Creates a durable season-rating queue entry that preserves the original user rating timestamp.
 * This keeps offline intent separate from confirmed bridge truth from the very first write.
 */
export function createSeasonRatingQueueEntry(
  input: CreateSeasonRatingQueueEntryInput,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): SeasonRatingQueueEntry {
  const now = clock.now();

  return {
    seasonId: input.seasonId,
    animeId: input.animeId,
    nota: input.nota,
    ratedAt: input.ratedAt,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    lastAttemptAt: null,
    lastFailureKind: null,
  };
}

/**
 * Persists one season-rating intent into the dedicated durable queue before runtime delivery.
 * Writing intent first guarantees pending UI truth even when the immediate bridge attempt never starts.
 */
export async function enqueueSeasonRatingIntent(
  rawDb: SQLiteDatabase,
  input: CreateSeasonRatingQueueEntryInput,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): Promise<SeasonRatingQueueEntry> {
  const entry = createSeasonRatingQueueEntry(input, clock);

  await withDeferredWrite(rawDb, async (db) => {
    await db.insert(seasonRatingQueue).values(entry);
  });

  return entry;
}

/**
 * Marks one queue entry as actively syncing while preserving the immutable rating intent fields.
 * The runtime can use this transition to distinguish backlog rows from in-flight delivery attempts.
 */
export function markSeasonRatingQueueEntrySyncing(
  entry: SeasonRatingQueueEntry,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): SeasonRatingQueueEntry {
  const now = clock.now();

  return {
    ...entry,
    status: 'syncing',
    updatedAt: now,
    lastAttemptAt: now,
    lastFailureKind: null,
  };
}

/**
 * Classifies one season-rating delivery attempt into retryable, confirmed, or terminal semantics.
 * The branch table keeps season ratings independent from anime reconcile status handling.
 */
export function resolveSeasonRatingDelivery(
  input: ResolveSeasonRatingDeliveryInput,
): SeasonRatingDeliveryResolution {
  if (input.error instanceof BridgeUnreachableError) {
    return {
      state: 'pending',
      nextQueueStatus: 'pending',
      shouldKeepEntry: true,
      shouldRetry: true,
      failureKind: 'unreachable',
    };
  }

  if (input.status === 204) {
    return {
      state: 'confirmed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: null,
    };
  }

  if (input.status === 404) {
    return {
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'not_found',
    };
  }

  if (input.status === 409) {
    return {
      state: 'failed',
      nextQueueStatus: null,
      shouldKeepEntry: false,
      shouldRetry: false,
      failureKind: 'conflict',
    };
  }

  if (input.status === 401) {
    return {
      state: 'failed',
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
      shouldRetry: false,
      failureKind: 'auth_repair',
    };
  }

  return {
    state: 'pending',
    nextQueueStatus: 'pending',
    shouldKeepEntry: true,
    shouldRetry: true,
    failureKind: input.status ? 'unexpected_response' : null,
  };
}

function mapQueueRow(row: Record<string, unknown>): SeasonRatingQueueEntry {
  return {
    id: Number(row.id),
    seasonId: String(row.season_id),
    animeId: String(row.anime_id),
    nota: Number(row.nota),
    ratedAt: Number(row.rated_at),
    status: row.status as SeasonRatingQueueEntry['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastAttemptAt:
      row.last_attempt_at === null || row.last_attempt_at === undefined
        ? null
        : Number(row.last_attempt_at),
    lastFailureKind:
      row.last_failure_kind === null || row.last_failure_kind === undefined
        ? null
        : (String(row.last_failure_kind) as SeasonRatingQueueEntry['lastFailureKind']),
  };
}

async function readSeasonRatingQueueBacklog(
  rawDb: SQLiteDatabase,
): Promise<SeasonRatingQueueEntry[]> {
  const rows = await rawDb.getAllAsync<Record<string, unknown>>(
    [
      'SELECT',
      '  id,',
      '  season_id,',
      '  anime_id,',
      '  nota,',
      '  rated_at,',
      '  status,',
      '  created_at,',
      '  updated_at,',
      '  last_attempt_at,',
      '  last_failure_kind',
      'FROM season_rating_queue',
      "WHERE status IN ('pending', 'syncing')",
      'ORDER BY created_at ASC, id ASC',
    ].join(' '),
  );

  return rows.map(mapQueueRow);
}

async function updateSeasonRatingQueueEntry(
  rawDb: SQLiteDatabase,
  entryId: number,
  entry: SeasonRatingQueueEntry,
) {
  await rawDb.runAsync(
    [
      'UPDATE season_rating_queue',
      'SET status = ?, updated_at = ?, last_attempt_at = ?, last_failure_kind = ?',
      'WHERE id = ?',
    ].join(' '),
    entry.status,
    entry.updatedAt,
    entry.lastAttemptAt,
    entry.lastFailureKind,
    entryId,
  );
}

async function deleteSeasonRatingQueueEntry(rawDb: SQLiteDatabase, entryId: number) {
  await rawDb.runAsync('DELETE FROM season_rating_queue WHERE id = ?', entryId);
}

/**
 * Drains durable season-rating intent through the bridge adapter while preserving pending-vs-confirmed truth.
 * Retryable failures remain queued, terminal responses drop stale intent, and only bridge-confirmed delivery clears the row.
 */
export async function drainSeasonRatingQueue(
  rawDb: SQLiteDatabase,
  clock: SeasonRatingQueueClock = defaultQueueClock,
): Promise<DrainSeasonRatingQueueResult> {
  const config = await getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    return {
      deliveredCount: 0,
      backlogReadCount: 0,
      shouldRefreshActiveSeason: false,
    };
  }

  const backlog = await readSeasonRatingQueueBacklog(rawDb);
  let deliveredCount = 0;
  let shouldRefreshActiveSeason = false;

  for (const queuedEntry of backlog) {
    if (!queuedEntry.id) {
      continue;
    }

    const syncingEntry = markSeasonRatingQueueEntrySyncing(queuedEntry, clock);

    await withDeferredWrite(rawDb, async (_db, tx) => {
      await updateSeasonRatingQueueEntry(tx, queuedEntry.id!, syncingEntry);
    });

    let deliveryResolution: SeasonRatingDeliveryResolution;

    try {
      const result = await bridgeClient.postActiveSeasonRating(
        {
          ip: config.ip,
          port: config.port,
          token: config.token,
        },
        {
          animeId: queuedEntry.animeId,
          nota: queuedEntry.nota,
          ratedAt: queuedEntry.ratedAt,
        },
      );
      deliveryResolution = resolveSeasonRatingDelivery({ status: result.status });
    } catch (error) {
      deliveryResolution = resolveSeasonRatingDelivery({ error });
    }

    if (!deliveryResolution.shouldKeepEntry) {
      await withDeferredWrite(rawDb, async (_db, tx) => {
        await deleteSeasonRatingQueueEntry(tx, queuedEntry.id!);
      });
    } else if (deliveryResolution.nextQueueStatus) {
      const nextQueueStatus = deliveryResolution.nextQueueStatus;

      await withDeferredWrite(rawDb, async (_db, tx) => {
        await updateSeasonRatingQueueEntry(tx, queuedEntry.id!, {
          ...syncingEntry,
          status: nextQueueStatus,
          updatedAt: clock.now(),
          lastAttemptAt: syncingEntry.lastAttemptAt,
          lastFailureKind: deliveryResolution.failureKind,
        });
      });
    }

    if (deliveryResolution.state === 'confirmed') {
      deliveredCount += 1;
    }

    if (deliveryResolution.state === 'confirmed' || deliveryResolution.failureKind === 'conflict' || deliveryResolution.failureKind === 'not_found') {
      shouldRefreshActiveSeason = true;
    }
  }

  return {
    deliveredCount,
    backlogReadCount: backlog.length,
    shouldRefreshActiveSeason,
  };
}
