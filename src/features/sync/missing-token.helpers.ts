import type { SQLiteDatabase } from 'expo-sqlite';
import { and, eq, isNull } from 'drizzle-orm';
import { bridgeClient } from '../../infrastructure/api';
import type { BridgeConnection } from '../../infrastructure/api';
import { withLocalWrite } from '../../infrastructure/db/client/client.helpers';
import type { AppDatabase } from '../../infrastructure/db/client/client.types';
import { animes, operationLog } from '../../infrastructure/db/schema';
import type { OperationLogRow } from '../../infrastructure/db/schema';
import { UNRESOLVED_REASON } from './missing-token.constants';
import type { MissingTokenOutcome, UnresolvedReason } from './missing-token.types';
import { RELEASED_CLAIM } from './outbox-claim.constants';
import { heldOperationsWhere } from './outbox-claim.helpers';
import type { OutboxClaim } from './outbox-claim.types';

/** Reads the `modified_at` token of a fetched `MobileAnime`, or `null` when it carries none. */
function readFetchedToken(data: unknown): number | null {
  const token = (data as { modified_at?: unknown } | null)?.modified_at;

  return Number.isInteger(token) ? (token as number) : null;
}

/**
 * Asks the bridge for one anime whose token is missing (ADR 009 R-3). Four outcomes: a transport
 * failure or any status other than 200/404 keeps the key pending; a 404 and an anime with no token
 * give the key up, the latter logged; a token lets the key be sent on it.
 */
export async function fetchMissingTokenOutcome(
  connection: BridgeConnection,
  animeId: string,
): Promise<MissingTokenOutcome> {
  let result;
  try {
    result = await bridgeClient.getAnime(connection, animeId);
  } catch {
    return { kind: 'unreachable' };
  }

  if (result.status === 404) {
    return { kind: 'unresolved', reason: UNRESOLVED_REASON.bridgeNotFound };
  }

  if (!result.ok) {
    return { kind: 'unreachable' };
  }

  const token = readFetchedToken(result.data);

  if (token === null) {
    console.warn(`[syncPendingOperations] ${UNRESOLVED_REASON.tokenMissing}: the bridge returned an anime with no token`, {
      animeId,
    });
    return { kind: 'unresolved', reason: UNRESOLVED_REASON.tokenMissing };
  }

  return { kind: 'token', token };
}

/**
 * Gives a key up: its held rows and its unclaimed pending rows become `dead_letter` with the reason,
 * all released. The whole key goes, since none of its rows can be sent without a base.
 */
async function giveKeyUp(
  db: AppDatabase,
  animeId: string,
  heldIds: readonly number[],
  claim: OutboxClaim,
  reason: UnresolvedReason,
): Promise<void> {
  const unresolved = { status: 'dead_letter', unresolvedReason: reason, ...RELEASED_CLAIM };

  await db.update(operationLog).set(unresolved).where(heldOperationsWhere(heldIds, claim));
  await db
    .update(operationLog)
    .set(unresolved)
    .where(and(eq(operationLog.animeId, animeId), eq(operationLog.status, 'pending'), isNull(operationLog.claimedAt)));
}

/** Writes one fetch-first outcome for `animeId` inside the caller's open write door. */
async function applyMissingTokenOutcome(
  db: AppDatabase,
  animeId: string,
  heldIds: readonly number[],
  claim: OutboxClaim,
  outcome: MissingTokenOutcome,
): Promise<void> {
  if (outcome.kind === 'token') {
    // Only the token, and only while none is stored: the fetched fields never touch the row.
    await db
      .update(animes)
      .set({ bridgeModifiedAt: outcome.token })
      .where(and(eq(animes._id, animeId), isNull(animes.bridgeModifiedAt)));
    return;
  }

  if (outcome.kind === 'unreachable') {
    await db.update(operationLog).set({ status: 'pending', ...RELEASED_CLAIM }).where(heldOperationsWhere(heldIds, claim));
    return;
  }

  await giveKeyUp(db, animeId, heldIds, claim, outcome.reason);
}

/**
 * The claim holder's fetch-first step (ADR 009 R-3): a held row whose anime has no stored token is
 * never sent without a base. Each such anime is fetched once; its outcome is written, the token is
 * added to `tokensByAnimeId`, and only the rows that can now carry a base are returned.
 */
export async function resolveMissingTokens(
  rawDb: SQLiteDatabase,
  connection: BridgeConnection,
  claim: OutboxClaim,
  heldOps: readonly OperationLogRow[],
  tokensByAnimeId: Map<string, number | null>,
): Promise<OperationLogRow[]> {
  const missing = [...new Set(heldOps.map((operation) => operation.animeId))].filter(
    (animeId) => (tokensByAnimeId.get(animeId) ?? null) === null,
  );

  if (missing.length === 0) {
    return [...heldOps];
  }

  const outcomes = new Map<string, MissingTokenOutcome>();
  for (const animeId of missing) {
    // eslint-disable-next-line react-doctor/async-await-in-loop -- one bounded request per anime, sequential so a down bridge costs one timeout at a time, not a burst.
    outcomes.set(animeId, await fetchMissingTokenOutcome(connection, animeId));
  }

  const heldIdsByAnimeId = new Map<string, number[]>();
  for (const operation of heldOps) {
    heldIdsByAnimeId.set(operation.animeId, [...(heldIdsByAnimeId.get(operation.animeId) ?? []), operation.id]);
  }

  await withLocalWrite(rawDb, async (db) => {
    for (const [animeId, outcome] of outcomes) {
      // eslint-disable-next-line react-doctor/async-await-in-loop -- sequential by design: every write shares the one write-door transaction.
      await applyMissingTokenOutcome(db, animeId, heldIdsByAnimeId.get(animeId) ?? [], claim, outcome);
    }
  });

  const sendable: OperationLogRow[] = [];
  for (const operation of heldOps) {
    const outcome = outcomes.get(operation.animeId);
    if (outcome?.kind === 'token') {
      tokensByAnimeId.set(operation.animeId, outcome.token);
    }
    if (outcome === undefined || outcome.kind === 'token') {
      sendable.push(operation);
    }
  }

  return sendable;
}
