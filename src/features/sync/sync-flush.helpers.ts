import type { SQLiteDatabase } from 'expo-sqlite';
import {
  beginSyncConnectionAttempt,
  invalidateSyncConnectionOnline,
} from './sync-connection-store/sync-connection-store.helpers';
import {
  ACTIVE_SEASON_REFRESH_FLUSH_REASONS,
  SYNC_FLUSH_DISPATCHER,
  SYNC_FLUSH_REASON_SOURCES,
  SYNC_FLUSH_STATES,
} from './sync-flush.constants';
import type {
  SyncFlushDispatcher,
  SyncFlushFollowUp,
  SyncFlushReason,
  SyncFlushRequest,
  SyncFlushState,
} from './sync-flush.types';

/**
 * Registers the JS dispatcher, the only code that sends to the bridge (ADR 009 R-2). The
 * foreground runtime registers it while mounted; the returned function unregisters it, and only
 * when it is still the registered one.
 */
export function registerSyncFlushDispatcher(dispatcher: SyncFlushDispatcher): () => void {
  SYNC_FLUSH_DISPATCHER.current = dispatcher;

  return () => {
    if (SYNC_FLUSH_DISPATCHER.current === dispatcher) {
      SYNC_FLUSH_DISPATCHER.current = null;
    }
  };
}

/**
 * The one entry point for outbound work (ADR 009 R-2): a caller enqueues its intent durably, then
 * asks for a flush with its reason. Nothing else in JS sends.
 *
 * Single-flight per database: with no cycle running, the dispatcher starts one now. A request that
 * arrives while a cycle runs schedules exactly one follow-up, which every later request joins, so
 * cycles never overlap and work enqueued mid-cycle is never left for the next trigger. Queuing the
 * follow-up starts a newer connection attempt, so the running cycle can no longer publish `online`
 * over work it never read.
 *
 * Resolves `0` without sending while no dispatcher is registered: JS has no background
 * responsibility (ADR 009 constraint 2), so the rows wait for the native engine or the next
 * foreground trigger.
 */
export function requestFlush(database: SQLiteDatabase, reason: SyncFlushReason): Promise<number> {
  const dispatcher = SYNC_FLUSH_DISPATCHER.current;

  if (!dispatcher) {
    return Promise.resolve(0);
  }

  const state = SYNC_FLUSH_STATES.get(database);

  if (!state) {
    return startFlush(database, dispatcher, [reason]);
  }

  if (state.followUp) {
    state.followUp.reasons.push(reason);
    return state.followUp.promise;
  }

  state.followUp = createFollowUp(reason);
  beginSyncConnectionAttempt();

  return state.followUp.promise;
}

/**
 * Resolves once no cycle runs and none is queued for `database`, whatever their outcome. It lets
 * a caller that only kicked a flush (an enqueue) observe when that flush settled.
 */
export async function waitForSyncFlushIdle(database: SQLiteDatabase): Promise<void> {
  let state = SYNC_FLUSH_STATES.get(database);

  while (state) {
    await state.running.catch(() => undefined);
    // A follow-up starts one microtask after the running cycle settles.
    await Promise.resolve();
    state = SYNC_FLUSH_STATES.get(database);
  }
}

/** Resets the dispatcher and every single-flight state so tests cannot leak runs between cases. */
export function resetSyncFlush(): void {
  SYNC_FLUSH_DISPATCHER.current = null;
  SYNC_FLUSH_STATES.clear();
}

/** Merges the reasons one run serves into the dispatcher's request; the first reason names the source. */
function buildSyncFlushRequest(
  database: SQLiteDatabase,
  reasons: readonly SyncFlushReason[],
): SyncFlushRequest {
  return {
    database,
    source: SYNC_FLUSH_REASON_SOURCES[reasons[0]],
    refreshActiveSeason: reasons.some((reason) => ACTIVE_SEASON_REFRESH_FLUSH_REASONS.has(reason)),
  };
}

/** Starts one run now, synchronously, so its connection attempt begins before the caller resumes. */
function startFlush(
  database: SQLiteDatabase,
  dispatcher: SyncFlushDispatcher,
  reasons: readonly SyncFlushReason[],
): Promise<number> {
  let running: Promise<number>;

  try {
    running = dispatcher(buildSyncFlushRequest(database, reasons));
  } catch (error) {
    running = Promise.reject(error);
  }

  const state: SyncFlushState = { running, followUp: null };
  SYNC_FLUSH_STATES.set(database, state);

  const settle = () => {
    settleFlush(database, state);
  };
  void running.then(settle, settle);

  return running;
}

/** Ends a run and starts its follow-up, if one was queued, with the dispatcher registered now. */
function settleFlush(database: SQLiteDatabase, state: SyncFlushState): void {
  const { followUp } = state;
  SYNC_FLUSH_STATES.delete(database);

  if (!followUp) {
    return;
  }

  const dispatcher = SYNC_FLUSH_DISPATCHER.current;

  if (!dispatcher) {
    // Queuing the follow-up showed `syncing`; with no run left to settle it, the work is pending.
    invalidateSyncConnectionOnline();
    followUp.resolve(0);
    return;
  }

  startFlush(database, dispatcher, followUp.reasons).then(followUp.resolve, followUp.reject);
}

/** Builds the deferred follow-up every request arriving during a running cycle shares. */
function createFollowUp(reason: SyncFlushReason): SyncFlushFollowUp {
  let resolve!: (syncedCount: number) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<number>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { reasons: [reason], promise, resolve, reject };
}
