import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient, BridgeUnreachableError } from '../../infrastructure/api';
import type { BridgeConnection } from '../../infrastructure/api';
import { getBridgeConfigSnapshot, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { seasonRatingQueue } from '../../infrastructure/db/schema';
import { JS_OUTBOX_CLAIM_OWNER } from './outbox-claim.constants';
import { liveClaimFloor } from './outbox-claim.helpers';
import type { OutboxClaim } from './outbox-claim.types';
import { DEFAULT_SEASON_RATING_QUEUE_CLOCK } from './season-rating-queue.constants';
import { invalidateSyncConnectionOnline } from './sync-connection-store/sync-connection-store.helpers';
import { requestFlush } from './sync-flush.helpers';
import { UNRESOLVED_RATING_FAILURE_KINDS } from './unresolved-key.constants';
import { logAutomaticResolutions, resolveSupersededRatings } from './unresolved-supersede.helpers';
import type {
  CreateSeasonRatingQueueEntryInput,
  DrainSeasonRatingQueueResult,
  ResolveSeasonRatingDeliveryInput,
  SeasonRatingDeliveryResolution,
  SeasonRatingQueueClock,
  SeasonRatingQueueEntry,
} from './season-rating-queue.types';


/**
 * Creates a durable season-rating queue entry that preserves the original user rating timestamp.
 * This keeps offline intent separate from confirmed bridge truth from the very first write.
 */
export function createSeasonRatingQueueEntry(
  input: CreateSeasonRatingQueueEntryInput,
  clock: SeasonRatingQueueClock = DEFAULT_SEASON_RATING_QUEUE_CLOCK,
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
 * Then it asks the one entry point for a flush (ADR 009 R-2, I1), so a rating made while the
 * bridge is reachable leaves without waiting for another trigger. The flush outcome is the
 * dispatched cycle's to publish; the caller only waits for the durable write.
 */
export async function enqueueSeasonRatingIntent(
  rawDb: SQLiteDatabase,
  input: CreateSeasonRatingQueueEntryInput,
  clock: SeasonRatingQueueClock = DEFAULT_SEASON_RATING_QUEUE_CLOCK,
): Promise<SeasonRatingQueueEntry> {
  const entry = createSeasonRatingQueueEntry(input, clock);

  await withLocalWrite(rawDb, async (db) => {
    await db.insert(seasonRatingQueue).values(entry);
  });

  invalidateSyncConnectionOnline();
  void requestFlush(rawDb, 'season_rating').catch(() => undefined);

  return entry;
}

/**
 * Marks one queue entry as actively syncing while preserving the immutable rating intent fields.
 * The runtime can use this transition to distinguish backlog rows from in-flight delivery attempts.
 */
export function markSeasonRatingQueueEntrySyncing(
  entry: SeasonRatingQueueEntry,
  clock: SeasonRatingQueueClock = DEFAULT_SEASON_RATING_QUEUE_CLOCK,
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
 * Every 4xx is terminal and kept as an unresolved rating (`failed` with its failure kind, ADR 009
 * R-5 and R-16b), never dropped: the backlog skips it until its key is resolved. A transport
 * failure, a 5xx, or any other answer stays `pending` for the next drain.
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
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
      shouldRetry: false,
      failureKind: 'not_found',
    };
  }

  if (input.status === 409) {
    return {
      state: 'failed',
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
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

  // Any other 4xx: the bridge rejected this message, so retrying it can never succeed. It is
  // kept as unresolved, the fate a 4xx has in the anime outbox (ADR 009 R-5).
  if (input.status !== undefined && input.status >= 400 && input.status < 500) {
    return {
      state: 'failed',
      nextQueueStatus: 'failed',
      shouldKeepEntry: true,
      shouldRetry: false,
      failureKind: 'rejected',
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

/** Normalizes a raw `last_failure_kind` column value, rejecting anything that is not a string. */
function readFailureKind(value: unknown): SeasonRatingQueueEntry['lastFailureKind'] {
  if (typeof value !== 'string') {
    return null;
  }
  return value as SeasonRatingQueueEntry['lastFailureKind'];
}

/** Maps a raw `season_rating_queue` SQLite row into its typed `SeasonRatingQueueEntry` shape. */
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
    lastFailureKind: readFailureKind(row.last_failure_kind),
  };
}

/** Reads every sendable season-rating queue row (unresolved ratings excluded), oldest first. */
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
      "WHERE status IN ('pending', 'syncing', 'failed')",
      // An unresolved rating (ADR 009 R-16b) is never sent again until its key is resolved.
      `AND NOT (status = 'failed' AND last_failure_kind IN (${UNRESOLVED_RATING_FAILURE_KINDS.map(() => '?').join(', ')}))`,
      'ORDER BY created_at ASC, id ASC',
    ].join(' '),
    ...UNRESOLVED_RATING_FAILURE_KINDS,
  );

  return rows.map(mapQueueRow);
}

// `tx` (not `rawDb`) because these two are only ever called from inside an already-open
// `withLocalWrite` door in `drainSeasonRatingQueue` -- never call the door again here, an
// already-open door is exactly the no-nested-doors case (design.md Regression Guard).
/**
 * Claims one queued row for this drain and marks it `syncing` (ADR 009 R-13). The key is the
 * season: the write is compare-and-set, and matches nothing while ANY row of the same season
 * carries a live claim, whoever holds it. Returns whether the claim was won.
 */
async function claimSeasonRatingQueueEntry(
  tx: SQLiteDatabase,
  entryId: number,
  entry: SeasonRatingQueueEntry,
  claim: OutboxClaim,
): Promise<boolean> {
  const result = await tx.runAsync(
    [
      'UPDATE season_rating_queue',
      'SET status = ?, updated_at = ?, last_attempt_at = ?, last_failure_kind = ?,',
      '  claim_owner = ?, claimed_at = ?',
      "WHERE id = ? AND status IN ('pending', 'syncing', 'failed')",
      'AND NOT EXISTS (',
      '  SELECT 1 FROM season_rating_queue AS sibling',
      '  WHERE sibling.season_id = season_rating_queue.season_id AND sibling.claimed_at > ?',
      ')',
    ].join(' '),
    entry.status,
    entry.updatedAt,
    entry.lastAttemptAt,
    entry.lastFailureKind,
    claim.owner,
    claim.claimedAt,
    entryId,
    liveClaimFloor(claim.claimedAt),
  );

  return result.changes === 1;
}

/**
 * Persists one claimed row's status/attempt/failure-kind columns and releases the claim. The
 * write is compare-and-set on the claim: a row the other runtime took over is never touched.
 */
async function updateSeasonRatingQueueEntry(
  tx: SQLiteDatabase,
  entryId: number,
  entry: SeasonRatingQueueEntry,
  claim: OutboxClaim,
) {
  await tx.runAsync(
    [
      'UPDATE season_rating_queue',
      'SET status = ?, updated_at = ?, last_attempt_at = ?, last_failure_kind = ?,',
      '  claim_owner = NULL, claimed_at = NULL',
      'WHERE id = ? AND claim_owner = ? AND claimed_at = ?',
    ].join(' '),
    entry.status,
    entry.updatedAt,
    entry.lastAttemptAt,
    entry.lastFailureKind,
    entryId,
    claim.owner,
    claim.claimedAt,
  );
}

/** Deletes one confirmed row, only while this claim still holds it. */
async function deleteSeasonRatingQueueEntry(
  tx: SQLiteDatabase,
  entryId: number,
  claim: OutboxClaim,
) {
  await tx.runAsync(
    'DELETE FROM season_rating_queue WHERE id = ? AND claim_owner = ? AND claimed_at = ?',
    entryId,
    claim.owner,
    claim.claimedAt,
  );
}

/** Posts one queued season rating to the bridge and classifies the outcome. */
async function deliverQueuedSeasonRating(
  connection: BridgeConnection,
  queuedEntry: SeasonRatingQueueEntry,
): Promise<SeasonRatingDeliveryResolution> {
  try {
    const result = await bridgeClient.postActiveSeasonRating(connection, {
      animeId: queuedEntry.animeId,
      nota: queuedEntry.nota,
      ratedAt: queuedEntry.ratedAt,
    });

    return resolveSeasonRatingDelivery({ status: result.status });
  } catch (error) {
    return resolveSeasonRatingDelivery({ error });
  }
}

/**
 * Claims, delivers and settles ONE queued rating. Returns its delivery resolution, or `null` when
 * the season belongs to whoever holds a live claim on it (R-13: skip it, never wait).
 */
async function drainOneSeasonRating(
  rawDb: SQLiteDatabase,
  connection: BridgeConnection,
  queuedEntry: SeasonRatingQueueEntry & { readonly id: number },
  clock: SeasonRatingQueueClock,
): Promise<SeasonRatingDeliveryResolution | null> {
  const syncingEntry = markSeasonRatingQueueEntrySyncing(queuedEntry, clock);
  const claim: OutboxClaim = { owner: JS_OUTBOX_CLAIM_OWNER, claimedAt: clock.now() };
  const claimed = await withLocalWrite(rawDb, (_db, tx) =>
    claimSeasonRatingQueueEntry(tx, queuedEntry.id, syncingEntry, claim),
  );

  if (!claimed) {
    return null;
  }

  const resolution = await deliverQueuedSeasonRating(connection, queuedEntry);
  // A null `nextQueueStatus` is the confirmation signal: `resolveSeasonRatingDelivery` pairs it
  // with `shouldKeepEntry: false` only for a 204. Branching on the status itself lets the type
  // narrow, so the kept branch needs no cast and no unreachable guard.
  const { nextQueueStatus } = resolution;

  if (nextQueueStatus === null) {
    const resolutions = await withLocalWrite(rawDb, async (_db, tx) => {
      await deleteSeasonRatingQueueEntry(tx, queuedEntry.id, claim);
      // The confirmed rating supersedes the given-up ratings of its key (ADR 009 R-16b).
      return resolveSupersededRatings(tx, queuedEntry);
    });
    logAutomaticResolutions(resolutions);
  } else {
    await withLocalWrite(rawDb, async (_db, tx) => {
      await updateSeasonRatingQueueEntry(tx, queuedEntry.id, {
        ...syncingEntry,
        status: nextQueueStatus,
        updatedAt: clock.now(),
        lastAttemptAt: syncingEntry.lastAttemptAt,
        lastFailureKind: resolution.failureKind,
      }, claim);
    });
  }

  return resolution;
}

/** Decides whether a delivery outcome should trigger an active-season refresh. */
function shouldRefreshAfterSeasonRatingDelivery(
  resolution: SeasonRatingDeliveryResolution,
): boolean {
  return resolution.state === 'confirmed'
    || resolution.failureKind === 'conflict'
    || resolution.failureKind === 'not_found';
}

/**
 * Drains durable season-rating intent through the bridge adapter while preserving pending-vs-confirmed truth.
 * Each rating is its own message (ADR 009 R-5): one that fails never stops the next one and never
 * fails the caller's cycle. A 4xx stays as an unresolved rating, a retryable failure or a failed
 * local write leaves the rating queued (`hasMorePending`), and only bridge-confirmed delivery
 * clears the row. A rating whose write failed while it was claimed is retaken once its claim
 * expires.
 */
export async function drainSeasonRatingQueue(
  rawDb: SQLiteDatabase,
  clock: SeasonRatingQueueClock = DEFAULT_SEASON_RATING_QUEUE_CLOCK,
): Promise<DrainSeasonRatingQueueResult> {
  const config = await getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    return {
      deliveredCount: 0,
      backlogReadCount: 0,
      shouldRefreshActiveSeason: false,
      hasMorePending: false,
    };
  }

  const connection = { ip: config.ip, port: config.port, token: config.token };
  const backlog = await readSeasonRatingQueueBacklog(rawDb);
  let deliveredCount = 0;
  let shouldRefreshActiveSeason = false;
  let hasMorePending = false;

  for (const queuedEntry of backlog) {
    if (!queuedEntry.id) {
      continue;
    }

    let resolution: SeasonRatingDeliveryResolution | null;

    try {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: this drains an ordered outbox queue against the bridge (claim -> deliver -> resolve) per entry; parallelizing would fire concurrent network deliveries out of FIFO order.
      resolution = await drainOneSeasonRating(rawDb, connection, { ...queuedEntry, id: queuedEntry.id }, clock);
    } catch (error) {
      console.warn('[drainSeasonRatingQueue] Season rating left queued after a local write failed', error);
      hasMorePending = true;
      continue;
    }

    if (resolution === null) {
      continue;
    }

    if (resolution.state === 'confirmed') {
      deliveredCount += 1;
    }

    if (resolution.state === 'pending') {
      hasMorePending = true;
    }

    if (shouldRefreshAfterSeasonRatingDelivery(resolution)) {
      shouldRefreshActiveSeason = true;
    }
  }

  return {
    deliveredCount,
    backlogReadCount: backlog.length,
    shouldRefreshActiveSeason,
    hasMorePending,
  };
}
