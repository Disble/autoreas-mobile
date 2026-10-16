import { and, eq, inArray, type SQL } from 'drizzle-orm';
import type { SQLiteDatabase } from 'expo-sqlite';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { operationLog } from '../../infrastructure/db/schema';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { OUTBOX_CLAIM_TTL_MS } from './outbox-claim.constants';
import type { OutboxClaim, OutboxClaimOwner } from './outbox-claim.types';
import { readOperationLogBacklog } from './operation-log-retention.helpers';

/** The epoch-ms floor above which a `claimed_at` is still live at `now`. */
export function liveClaimFloor(now: number): number {
  return now - OUTBOX_CLAIM_TTL_MS;
}

/**
 * Reads and claims the `operation_log` backlog in ONE step (ADR 009 R-13), inside its own
 * `withLocalWrite` door: the read and the claim must share the `BEGIN IMMEDIATE`, or the other
 * runtime can claim a key between them. The claim time is taken inside the door, so a wait for
 * the write lock never shortens the claim's life.
 *
 * Keys (animes) with a live claim are skipped, whoever holds it; expired claims and rows with
 * no claim are taken. The update is compare-and-set on status and on the claim still being
 * absent or expired, so a row it does not win is dropped from the result.
 */
export function claimOperationLogBatch(
  rawDb: SQLiteDatabase,
  params: {
    readonly owner: OutboxClaimOwner;
    readonly limit: number;
    /** Runs once, only when there is something to claim, right before the claim is written. */
    readonly onClaim?: () => void;
  },
): Promise<{ readonly claim: OutboxClaim; readonly rows: OperationLogRow[] }> {
  return withLocalWrite(rawDb, async (_db, tx) => {
    const claim: OutboxClaim = { owner: params.owner, claimedAt: Date.now() };
    const rows = await claimBacklogRows(tx, claim, params);

    return { claim, rows };
  });
}

/** The read-then-claim body of {@link claimOperationLogBatch}, run inside its open door. */
async function claimBacklogRows(
  tx: SQLiteDatabase,
  claim: OutboxClaim,
  params: { readonly limit: number; readonly onClaim?: () => void },
): Promise<OperationLogRow[]> {
  const { limit, onClaim } = params;
  const floor = liveClaimFloor(claim.claimedAt);
  const candidates = await readOperationLogBacklog(tx, {
    status: ['pending', 'processing'],
    limit,
    orderBy: 'oldest_first',
    dedupeBy: 'anime_id',
    skipKeysClaimedAfter: floor,
  });

  if (candidates.length === 0) {
    return [];
  }

  onClaim?.();
  const placeholders = candidates.map(() => '?').join(', ');
  await tx.runAsync(
    [
      "UPDATE operation_log SET status = 'processing', claim_owner = ?, claimed_at = ?",
      `WHERE id IN (${placeholders})`,
      "AND status IN ('pending', 'processing')",
      'AND (claimed_at IS NULL OR claimed_at <= ?)',
    ].join(' '),
    claim.owner,
    claim.claimedAt,
    ...candidates.map((row) => row.id),
    floor,
  );

  const heldIds = new Set(await readHeldOperationIds(tx, candidates.map((row) => row.id), claim));

  const claimed: OperationLogRow[] = [];

  for (const row of candidates) {
    if (heldIds.has(row.id)) {
      claimed.push({ ...row, status: 'processing' });
    }
  }

  return claimed;
}

/**
 * Returns the ids among `ids` that this exact claim still holds. The holder re-checks before
 * each send (ADR 009 R-13): a claim can expire and be taken over while the holder waits.
 */
export async function readHeldOperationIds(
  db: SQLiteDatabase,
  ids: readonly number[],
  claim: OutboxClaim,
): Promise<number[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await db.getAllAsync<{ id: number }>(
    [
      'SELECT id FROM operation_log',
      `WHERE id IN (${ids.map(() => '?').join(', ')})`,
      "AND status = 'processing' AND claim_owner = ? AND claimed_at = ?",
    ].join(' '),
    ...ids,
    claim.owner,
    claim.claimedAt,
  );

  return rows.map((row) => row.id);
}

/**
 * The compare-and-set guard for every status write a claim holder makes on `ids`: the row must
 * still be `processing` under this exact claim. A row the other runtime confirmed or took over
 * matches nothing, so the write never reverts it.
 */
export function heldOperationsWhere(ids: readonly number[], claim: OutboxClaim): SQL | undefined {
  return and(
    inArray(operationLog.id, ids as number[]),
    eq(operationLog.status, 'processing'),
    eq(operationLog.claimOwner, claim.owner),
    eq(operationLog.claimedAt, claim.claimedAt),
  );
}
