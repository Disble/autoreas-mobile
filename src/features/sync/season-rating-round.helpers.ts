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
 * the attempt (I4), and the next rating is still sent.
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
    console.warn('[sendSeasonRatingRound] Could not record a rating answer; it is re-sent once its claim expires', {
      operationId: row.id,
      error,
    });
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
 * A rating's answer never fails the attempt (I4): every other message is still sent.
 */
export async function sendSeasonRatingRound(
  rawDb: SQLiteDatabase,
  context: { readonly connection: BridgeConnection; readonly claim: OutboxClaim; readonly chainDeadline: number },
  ratings: readonly OperationLogRow[],
): Promise<SeasonRatingRoundOutcome> {
  let confirmedCount = 0;
  let pendingCount = 0;
  let attemptedCount = 0;
  let shouldRefreshActiveSeason = false;
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

    confirmedCount += settled?.confirmed ? 1 : 0;
    // A row whose fate could not be written stays held until its claim expires, then is re-sent.
    pendingCount += fate.kind === 'pending' || settled === null ? 1 : 0;
    // A delivery, or a rejection that says the bridge's season differs (404, 409), changes what
    // the active-season snapshot should show.
    shouldRefreshActiveSeason ||= fate.kind === 'delivered'
      || (fate.kind === 'given_up' && (fate.reason === 'not_found' || fate.reason === 'conflict'));
    successors.push(...(settled?.successors ?? []));
  }

  return { confirmedCount, pendingCount, attemptedCount, shouldRefreshActiveSeason, successors };
}

/**
 * Releases a round's ratings unsent, back to `pending` (L28): their round's reconcile failed, so
 * the cycle stops before any of them goes out. Compare-and-set on the claim.
 */
export async function releaseSeasonRatings(
  rawDb: SQLiteDatabase,
  ratings: readonly OperationLogRow[],
  claim: OutboxClaim,
): Promise<void> {
  if (ratings.length === 0) {
    return;
  }

  await withLocalWrite(rawDb, async (writeDb) => {
    await writeDb
      .update(operationLog)
      .set({ status: 'pending', ...RELEASED_CLAIM })
      .where(heldOperationsWhere(ratings.map((row) => row.id), claim));
  });
}
