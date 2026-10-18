import type { SQLiteDatabase } from 'expo-sqlite';
import { bridgeClient } from '../../infrastructure/api';
import type { BridgeConnection } from '../../infrastructure/api';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import { operationLog } from '../../infrastructure/db/schema';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { RELEASED_CLAIM } from './outbox-claim.constants';
import { claimChainSuccessors, heldOperationsWhere, readHeldOperationIds } from './outbox-claim.helpers';
import type { OutboxClaim } from './outbox-claim.types';
import { buildSeasonRatingRequest, classifySeasonRatingAnswer } from './season-rating-event.helpers';
import { NOTHING_CONFIRMED } from './season-rating-event.constants';
import type { SeasonRatingFate, SeasonRatingRoundOutcome, SettledRating } from './season-rating-event.types';
import { logAutomaticResolutions, resolveSupersededRatings } from './unresolved-supersede.helpers';

/** Posts one rating and classifies its answer; a request that never got an answer stays pending. */
async function postSeasonRating(connection: BridgeConnection, row: OperationLogRow): Promise<SeasonRatingFate> {
  try {
    const result = await bridgeClient.postActiveSeasonRating(connection, buildSeasonRatingRequest(row));

    return classifySeasonRatingAnswer(result.status);
  } catch {
    // Transport failure or timeout: retryable, never given up (ADR 009 R-5).
    return classifySeasonRatingAnswer(null);
  }
}

/**
 * Writes `row`'s `fate` in one write door, compare-and-set on the claim (ADR 009 R-13): a row the
 * other runtime took over mid-request is not ours to write.
 */
function settleSeasonRating(
  rawDb: SQLiteDatabase,
  row: OperationLogRow,
  fate: SeasonRatingFate,
  claim: OutboxClaim,
  chainDeadline: number,
): Promise<SettledRating> {
  return withLocalWrite(rawDb, async (writeDb, tx) => {
    if ((await readHeldOperationIds(tx, [row.id], claim)).length === 0) {
      return NOTHING_CONFIRMED;
    }

    const held = heldOperationsWhere([row.id], claim);

    if (fate.kind === 'given_up') {
      await writeDb.update(operationLog).set({ status: 'dead_letter', unresolvedReason: fate.reason, ...RELEASED_CLAIM }).where(held);

      return NOTHING_CONFIRMED;
    }

    if (fate.kind === 'pending') {
      await writeDb.update(operationLog).set({ status: 'pending', ...RELEASED_CLAIM }).where(held);

      return NOTHING_CONFIRMED;
    }

    await writeDb.update(operationLog).set({ status: 'synced', ...RELEASED_CLAIM }).where(held);
    const resolutions = await resolveSupersededRatings(tx, row);
    const successors = Date.now() >= chainDeadline ? [] : await claimChainSuccessors(tx, [row.animeId], claim);

    return { confirmed: true, successors, resolutions };
  });
}

/**
 * Settles one rating, or answers `null` when its local write failed: a failed write never fails
 * the attempt (I4), and the next rating is still sent. The failed write rolled back, so the row is
 * still held; it is released to `pending` in a separate write (a resend is a 204 no-op).
 */
async function settleSafely(
  rawDb: SQLiteDatabase,
  row: OperationLogRow,
  fate: SeasonRatingFate,
  context: { readonly claim: OutboxClaim; readonly chainDeadline: number },
): Promise<SettledRating | null> {
  try {
    return await settleSeasonRating(rawDb, row, fate, context.claim, context.chainDeadline);
  } catch (error) {
    console.warn('[sendSeasonRatingRound] Could not record a rating answer; releasing it to pending', {
      operationId: row.id,
      error,
    });
    await releaseHeldRows(rawDb, [row.id], context.claim);
    return null;
  }
}

/**
 * Sends the season ratings of one round (ADR 009 R-14, L28), one message per request and oldest
 * first, after that round's reconcile; mirrors the Kotlin `SeasonRatingSender`. Before each send
 * the holder re-checks its claim (R-13), so a key the other runtime took over is never posted.
 * Each answer is settled in its own write door:
 * - 204: the row is `synced`, the given-up ratings of the same anime and season it supersedes are
 *   resolved (R-16b), and the key's next row is claimed while the chain budget lasts;
 * - a 4xx: the row is unresolved (`dead_letter`) with its reason, and its key stops this cycle;
 * - anything else: the row goes back to `pending`, released, and its key stops this cycle.
 *
 * A rating's answer never fails the attempt (I4): every other message is still sent, as it is after
 * a local write failure while settling one (`settleSafely`). Each successor a delivery claims is
 * reported through `onClaimed` at once, so the caller can release it if anything later fails.
 */
export async function sendSeasonRatingRound(
  rawDb: SQLiteDatabase,
  context: {
    readonly connection: BridgeConnection;
    readonly claim: OutboxClaim;
    readonly chainDeadline: number;
    readonly onClaimed: (rows: readonly OperationLogRow[]) => void;
  },
  ratings: readonly OperationLogRow[],
): Promise<SeasonRatingRoundOutcome> {
  let confirmedCount = 0;
  let pendingCount = 0;
  let attemptedCount = 0;
  let ratingDelivered = false;
  const successors: OperationLogRow[] = [];

  for (const row of ratings) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: one message per request, each settled before the next is sent.
    if ((await readHeldOperationIds(rawDb, [row.id], context.claim)).length === 0) {
      continue;
    }

    attemptedCount += 1;
    const fate = await postSeasonRating(context.connection, row);
    const settled = await settleSafely(rawDb, row, fate, context);
    logAutomaticResolutions(settled?.resolutions ?? []);
    context.onClaimed(settled?.successors ?? []);

    confirmedCount += settled?.confirmed ? 1 : 0;
    // A row whose fate could not be written was released to `pending`: it is still to send.
    pendingCount += fate.kind === 'pending' || settled === null ? 1 : 0;
    // Only a delivery makes the bridge record a ["season"] row; a 404 or 409 records nothing.
    ratingDelivered ||= fate.kind === 'delivered';
    successors.push(...(settled?.successors ?? []));
  }

  return { confirmedCount, pendingCount, attemptedCount, ratingDelivered, successors };
}

/**
 * Releases every row of `ids` this claim still holds back to `pending`, compare-and-set on the
 * claim (R-13), so a row already settled or taken over is never touched: a failed cycle's unsent
 * ratings and successors (L28), or one rating whose answer could not be written. Best effort, it
 * never throws: when this write fails too, the rows stay `processing` until their claim expires
 * (60 s) and the next cycle that claims them re-sends them.
 */
export async function releaseHeldRows(rawDb: SQLiteDatabase, ids: readonly number[], claim: OutboxClaim): Promise<void> {
  try {
    // Read first: after a failed reconcile its rows already have their fate, and a cycle that
    // holds nothing more should not take the write lock just to change nothing.
    const held = await readHeldOperationIds(rawDb, ids, claim);

    if (held.length === 0) {
      return;
    }

    await withLocalWrite(rawDb, async (writeDb) => {
      await writeDb.update(operationLog).set({ status: 'pending', ...RELEASED_CLAIM }).where(heldOperationsWhere(held, claim));
    });
  } catch (error) {
    console.warn('[releaseHeldRows] Could not release claimed rows; their claim expiry releases them', { ids, error });
  }
}
