import type { SQLiteDatabase } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import { bridgeClient } from '../../infrastructure/api';
import { createDrizzleDb, withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import {
  applyAnimeBridgeToken,
  persistConfirmedAnimeTokens,
  readAnimeBridgeTokens,
} from '../../infrastructure/db/anime-repository';
import { bridgeConfig, operationLog } from '../../infrastructure/db/schema';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { collectConfirmedAnimeTokens } from './applied-operation-token.helpers';
import { normalizeBridgeChange } from './bridge-change.helpers';
import { forwardOnlyChangelogCursor, shouldPersistLastChangelogId } from './last-changelog.helpers';
import { resolveMissingTokens } from './missing-token.helpers';
import { RELEASED_CLAIM } from './outbox-claim.constants';
import {
  claimChainSuccessors,
  heldOperationsWhere,
  readHeldOperationIds,
} from './outbox-claim.helpers';
import type { OutboxClaim } from './outbox-claim.types';
import { getConfirmedOperationIds } from './reconcile-confirmation.helpers';
import { classifyUnconfirmedOperations } from './reconcile-conflict.helpers';
import { buildReconcileRequestBody } from './reconcile-request.helpers';
import { RECONCILE_UNAUTHORIZED_STATUS } from './reconcile.constants';
import { ReconcileHttpError } from './reconcile.errors';
import { ReconcileResponseSchema } from './reconcile.schema';
import type {
  ApplyReconcileResponseWritesParams,
  ReconcileRoundContext,
  ReconcileRoundOutcome,
} from './reconcile.types';
import { applyStagedAndIncomingRemoteChanges } from './remote-change-drain.helpers';
import type { ConfirmedOperation } from './unresolved-key.types';
import { logAutomaticResolutions, resolveSupersededOperations } from './unresolved-supersede.helpers';

/**
 * Separates the failures that retrying can never fix from the ones it can.
 * Only a 4xx means the bridge rejected THIS batch's content, so those rows go to `dead_letter`;
 * everything else -- 5xx, transport, timeouts -- is the network or the bridge being temporarily
 * unavailable and must go back to `pending`. Widening this predicate silently discards local
 * edits that would have synced on the next attempt.
 */
function isPermanentReconcileError(error: unknown): error is ReconcileHttpError {
  return error instanceof ReconcileHttpError && error.status >= 400 && error.status < 500;
}

/**
 * Whether a whole-request failure is the bridge rejecting a MESSAGE (ADR 009 R-5): any 4xx but
 * 401. Retrying it never succeeds, and in a request carrying several messages nobody can tell
 * which one caused it. A 401 rejects the pairing, never a message, so it is not one.
 */
function isMessageRejection(error: unknown): error is ReconcileHttpError {
  return isPermanentReconcileError(error) && error.status !== RECONCILE_UNAUTHORIZED_STATUS;
}

/**
 * Logs the failed request next to the response that rejected it.
 * The bridge's body names what was wrong but not what was sent, so a status alone is not
 * diagnosable after the fact -- the body we posted is the half that identifies the offending
 * operation.
 */
function logReconcileHttpError(
  url: string,
  requestBody: ReturnType<typeof buildReconcileRequestBody>,
  error: ReconcileHttpError,
) {
  console.warn('[syncPendingOperations] Reconcile request failed', {
    url,
    requestBody,
    status: error.status,
    responseBody: error.responseBody,
  });
}

/**
 * Applies every write this cycle's response produced, all inside the ONE shared write door the
 * caller already opened. Extracted out of `syncPendingOperations` to keep that function's
 * cognitive complexity under threshold (constraint: "Complexity Budget Note") -- this function
 * owns nothing about WHEN to run (that stays `withLocalWrite`'s job), only WHAT to write and in
 * what order, per design.md Decision 1/2 (extended to Part 2's conflict outcomes, which are
 * column-disjoint from the confirmed write-back and so carry no ordering dependency against it).
 */
async function applyReconcileResponseWrites(
  writeDb: AppDatabase,
  params: ApplyReconcileResponseWritesParams,
): Promise<void> {
  const {
    normalizedChanges,
    confirmedAnimeTokens,
    conflictOutcomes,
    deadLetterIds,
    confirmedIds,
    remainingUnconfirmedIds,
    lastChangelogId,
    nextLastChangelogId,
    bridgeConfigId,
    claim,
  } = params;

  // Staged changes ride along (ADR 009 R-16a): one the outbox deferred in an earlier round is
  // re-evaluated here, and one deferred now is kept staged, because the cursor below moves past
  // it in this same transaction and will never return it again.
  await applyStagedAndIncomingRemoteChanges(writeDb, normalizedChanges);

  // MUST run after the `bridge_changes` apply above: that apply may be what CREATES the row
  // (an `update` for a record the device has never seen falls through to `upsertAnime`), and a
  // token write against a not-yet-existing row matches zero rows. Column-disjoint from the write
  // above (`bridge_modified_at` only, design.md Decision 2), so ordering here is a row-existence
  // dependency, never a conflict to resolve.
  await persistConfirmedAnimeTokens(writeDb, confirmedAnimeTokens);

  for (const outcome of conflictOutcomes) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: every write shares the caller's already-open write door on one SQLite connection.
    await applyAnimeBridgeToken(writeDb, outcome.animeId, outcome.bridgeModifiedAt);
    await writeDb
      .update(operationLog)
      .set({
        status: outcome.status,
        conflictAttemptCount: outcome.conflictAttemptCount,
        ...RELEASED_CLAIM,
      })
      .where(heldOperationsWhere([outcome.operationId], claim));
  }

  if (deadLetterIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'dead_letter', ...RELEASED_CLAIM })
      .where(heldOperationsWhere(deadLetterIds, claim));
  }

  if (confirmedIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'synced', ...RELEASED_CLAIM })
      .where(heldOperationsWhere(confirmedIds, claim));
  }

  if (remainingUnconfirmedIds.length > 0) {
    await writeDb
      .update(operationLog)
      .set({ status: 'pending', ...RELEASED_CLAIM })
      .where(heldOperationsWhere(remainingUnconfirmedIds, claim));
  }

  if (shouldPersistLastChangelogId(lastChangelogId, nextLastChangelogId)) {
    await writeDb
      .update(bridgeConfig)
      .set({ lastChangelogId: forwardOnlyChangelogCursor(nextLastChangelogId) })
      .where(eq(bridgeConfig.id, bridgeConfigId));
  }
}

/**
 * Moves rows this claim still holds to `status` and releases them. No-ops for an empty list.
 * Compare-and-set on the claim: a row the other runtime took over is never touched.
 */
async function releaseHeldOperations(
  rawDb: SQLiteDatabase,
  operations: readonly OperationLogRow[],
  claim: OutboxClaim,
  status: 'pending' | 'dead_letter',
): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  await withLocalWrite(rawDb, async (writeDb) => {
    await writeDb
      .update(operationLog)
      .set({ status, ...RELEASED_CLAIM })
      .where(heldOperationsWhere(operations.map((operation) => operation.id), claim));
  });
}

/**
 * Reverts a batch claimed `'processing'` back to a retry-eligible state after this cycle failed,
 * or moves it to `dead_letter` when the bridge's own 4xx response says the batch's CONTENT was
 * rejected (see `isPermanentReconcileError`). No-ops for an empty batch. Extracted out of
 * `syncPendingOperations`'s `catch` block to keep that function's cognitive complexity
 * under threshold (constraint: "Complexity Budget Note").
 */
function revertPendingOperationsOnFailure(
  rawDb: SQLiteDatabase,
  pendingOps: readonly OperationLogRow[],
  claim: OutboxClaim,
  error: unknown,
): Promise<void> {
  return releaseHeldOperations(rawDb, pendingOps, claim, isPermanentReconcileError(error) ? 'dead_letter' : 'pending');
}

/** Adds one round's outcome to the outcome of the rounds before it. */
function addRoundOutcome(total: ReconcileRoundOutcome, round: ReconcileRoundOutcome): ReconcileRoundOutcome {
  return {
    sentCount: total.sentCount + round.sentCount,
    confirmedCount: total.confirmedCount + round.confirmedCount,
    unconfirmedCount: total.unconfirmedCount + round.unconfirmedCount,
    nextLastChangelogId: round.nextLastChangelogId,
    successors: [...total.successors, ...round.successors],
  };
}

/**
 * Re-sends a rejected round one message per request (ADR 009 R-5), so a 4xx lands on the one
 * message that caused it: that message is dead-lettered and its key stops, while every other key
 * is confirmed and chained as usual. Only messages this claim still holds go out, without the
 * telemetry piggyback, each on the cursor the previous one reached.
 *
 * Any other failure on the way (network, 5xx, 401, a malformed answer, a failed local write) ends
 * it like a failed round: the failing message takes that failure's fate, every unsent message and
 * every successor already chained is released to `pending`, and the error is rethrown. When no
 * message got through, the last rejection is rethrown, so a round nobody accepted still fails.
 */
async function sendOneMessagePerRequest(
  rawDb: SQLiteDatabase,
  context: ReconcileRoundContext,
  operations: readonly OperationLogRow[],
  rejection: ReconcileHttpError,
): Promise<ReconcileRoundOutcome> {
  let total: ReconcileRoundOutcome = {
    sentCount: 0,
    confirmedCount: 0,
    unconfirmedCount: 0,
    nextLastChangelogId: context.lastChangelogId,
    successors: [],
  };
  let lastRejection = rejection;
  let delivered = false;

  // Sequential by design: each message waits for the previous answer and the cursor it reached.
  for (const [index, operation] of operations.entries()) {
    const held = await readHeldOperationIds(rawDb, [operation.id], context.claim);

    if (held.length === 0) {
      continue;
    }

    try {
      const single = await sendReconcileRound(
        rawDb,
        { ...context, clientTelemetry: null, lastChangelogId: total.nextLastChangelogId },
        [operation],
      );
      total = addRoundOutcome(total, single);
      delivered = true;
    } catch (error) {
      if (!isMessageRejection(error)) {
        await releaseHeldOperations(rawDb, [...operations.slice(index + 1), ...total.successors], context.claim, 'pending');
        throw error;
      }

      lastRejection = error;
      total = { ...total, sentCount: total.sentCount + 1, unconfirmedCount: total.unconfirmedCount + 1 };
    }
  }

  if (!delivered) {
    throw lastRejection;
  }

  return total;
}

/**
 * Sends ONE reconcile round for the rows a claim holds, and applies its response. A chain
 * (ADR 009 R-14) is a sequence of these: each round returns the next row of every key it
 * confirmed, already claimed, and the caller sends them as the next round.
 *
 * On any failure the round's rows are released (`revertPendingOperationsOnFailure`) and the
 * error is rethrown, which also ends the chain; earlier rounds stay committed. A message
 * rejection in a round of several messages is first isolated (`sendOneMessagePerRequest`).
 */
export async function sendReconcileRound(
  rawDb: SQLiteDatabase,
  context: ReconcileRoundContext,
  claimedRows: readonly OperationLogRow[],
): Promise<ReconcileRoundOutcome> {
  const { claim, connection, lastChangelogId } = context;

  // The holder re-checks its claim right before the send (ADR 009 R-13): the diagnostics flush
  // above is a network call, and a key whose claim expired and was taken over meanwhile belongs
  // to the other runtime now. Only rows still held under this exact claim go on the wire.
  const heldIds = new Set(
    await readHeldOperationIds(rawDb, claimedRows.map((operation) => operation.id), claim),
  );
  const heldOps = claimedRows.filter((operation) => heldIds.has(operation.id));
  // Read-only, outside any write door: the SAME shape `getBridgeConfigSnapshot` uses for its own
  // read. This is the value each operation's `base` is built from (Requirement 9) -- read here,
  // before the request goes out, so it reflects the token as of the moment this batch was sent.
  const bridgeTokensByAnimeId = await readAnimeBridgeTokens(
    createDrizzleDb(rawDb),
    heldOps.map((operation) => operation.animeId),
  );
  // Never without a base (ADR 009 R-3): an anime with no stored token is fetched first.
  const pendingOps = await resolveMissingTokens(rawDb, connection, claim, heldOps, bridgeTokensByAnimeId);
  const requestBody = buildReconcileRequestBody(
    context.deviceId,
    lastChangelogId,
    pendingOps,
    context.clientTelemetry,
    bridgeTokensByAnimeId,
  );

  try {
    const result = await bridgeClient.reconcile(connection, requestBody);

    if (!result.ok) {
      const error = new ReconcileHttpError(result.status, result.rawBody);

      logReconcileHttpError(result.url, requestBody, error);
      throw error;
    }

    const parsed = ReconcileResponseSchema.safeParse(result.data);

    if (!parsed.success) {
      throw new Error(`Invalid reconcile response: ${parsed.error.message}`);
    }

    const {
      applied_operations,
      bridge_changes,
      last_changelog_id: responseLastChangelogId,
    } = parsed.data;
    const nextLastChangelogId = responseLastChangelogId ?? lastChangelogId;
    // Pure, computed OUTSIDE the write door: `applied_operations` is the only valid token
    // source (never `bridge_changes[].snapshot.modified_at`, which the bridge hardcodes to 0 --
    // see design.md invariant 1 / Decision 2).
    const confirmedAnimeTokens = collectConfirmedAnimeTokens(applied_operations);
    const confirmedIds = getConfirmedOperationIds(
      pendingOps,
      applied_operations,
      bridge_changes,
    );
    const confirmedIdSet = new Set(confirmedIds);
    const unconfirmedIds: number[] = [];

    for (const operation of pendingOps) {
      if (!confirmedIdSet.has(operation.id)) {
        unconfirmedIds.push(operation.id);
      }
    }

    // Pure classification pass, outside the write door: for every unconfirmed operation with a
    // matching REJECTED (`applied: false`) entry, decide what it means (design.md Decision 6).
    // `remainingUnconfirmedIds` is the generic "reset to pending" bucket that Part 1 always used;
    // `deadLetterIds`/`conflictOutcomes` get their own explicit write inside the door instead, so
    // they must NOT also be swept into the generic bulk reset below.
    const { remainingUnconfirmedIds, deadLetterIds, conflictOutcomes } =
      classifyUnconfirmedOperations({
        unconfirmedIds,
        pendingOps,
        appliedOperations: applied_operations,
        bridgeTokensByAnimeId,
        now: Date.now(),
      });

    const normalizedChanges = bridge_changes.map(normalizeBridgeChange);

    // Route every pulled bridge change through the single merge boundary on the one shared write
    // door, so local `useLiveQuery` consumers observe the new data immediately. Op-log status
    // writes and the changelog cursor advance stay in the same transaction so confirmation/cursor
    // bookkeeping never drifts from the apply outcome.
    const { heldConfirmedCount, successors, resolutions } = await withLocalWrite(rawDb, async (writeDb, tx) => {
      // Re-read inside the door: a key the other runtime took over mid-request is not ours to
      // write, not even its token (ADR 009 R-13); its status writes already miss by CAS.
      const stillHeld = new Set(
        await readHeldOperationIds(tx, pendingOps.map((operation) => operation.id), claim),
      );
      const heldAnimeIds = new Set<string>();
      const confirmedOperations: ConfirmedOperation[] = [];

      for (const operation of pendingOps) {
        if (stillHeld.has(operation.id)) {
          heldAnimeIds.add(operation.animeId);

          if (confirmedIdSet.has(operation.id)) {
            confirmedOperations.push({ id: operation.id, animeId: operation.animeId });
          }
        }
      }
      const confirmedAnimeIds = confirmedOperations.map((operation) => operation.animeId);

      await applyReconcileResponseWrites(writeDb, {
        normalizedChanges,
        confirmedAnimeTokens: confirmedAnimeTokens.filter((token) => heldAnimeIds.has(token.animeId)),
        conflictOutcomes: conflictOutcomes.filter((outcome) => stillHeld.has(outcome.operationId)),
        deadLetterIds,
        confirmedIds,
        remainingUnconfirmedIds,
        lastChangelogId,
        nextLastChangelogId,
        bridgeConfigId: context.bridgeConfigId,
        claim,
      });

      // A confirmed later edit supersedes the edits of its key given up before it (ADR 009 R-16b):
      // resolved in this same transaction, logged only once it commits.
      const resolutions = await resolveSupersededOperations(tx, confirmedOperations);

      // The chain (ADR 009 R-14): every key whose row was just confirmed keeps its claim on its
      // next row, in this same transaction, until the cycle's chain budget runs out.
      const next = Date.now() >= context.chainDeadline
        ? []
        : await claimChainSuccessors(tx, confirmedAnimeIds, claim);

      // Only the confirmations this claim wrote count as synced here: a row the other runtime
      // took over mid-request is that runtime's to report (mirrors the Kotlin applier).
      return { heldConfirmedCount: confirmedAnimeIds.length, successors: next, resolutions };
    });
    logAutomaticResolutions(resolutions);

    return {
      sentCount: pendingOps.length,
      confirmedCount: heldConfirmedCount,
      unconfirmedCount: unconfirmedIds.length,
      nextLastChangelogId,
      successors,
    };
  } catch (error) {
    // A message rejection in a round of several messages cannot be pinned on one of them: send
    // each alone, so only the message that caused it takes its fate (ADR 009 R-5).
    if (isMessageRejection(error) && pendingOps.length > 1) {
      return sendOneMessagePerRequest(rawDb, context, pendingOps, error);
    }

    await revertPendingOperationsOnFailure(rawDb, pendingOps, claim, error);
    throw error;
  }
}
