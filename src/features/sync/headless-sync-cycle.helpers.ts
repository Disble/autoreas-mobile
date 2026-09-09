import { getBridgeConfigSnapshot } from '../../infrastructure/db/client/client.helpers';
import { withDeadline } from '../../infrastructure/async/deadline.helpers';
import { DeadlineExceededError } from '../../infrastructure/async/deadline.errors';
import {
  HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE,
  HEADLESS_SYNC_CYCLE_DEADLINE_MS,
  HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS,
} from './headless-sync-cycle.constants';
import { pruneOperationLog } from './operation-log-retention.helpers';
import { syncPendingOperations } from './reconcile.helpers';
import type { ReconcileTelemetryContext } from './reconcile.types';
import {
  drainDiagnosticEvents,
  recordDiagnosticEvent,
} from './sync-diagnostic-store/sync-diagnostic-store.helpers';
import {
  causeFromError,
  createSyncCycleId,
  normalizeNativeErrcodeByte,
  normalizeSyncCycleErrorName,
  normalizeSyncCycleErrorStage,
} from './sync-telemetry.helpers';
import {
  getSyncRuntimeStatusSnapshot,
  recordBacklogReadCount,
  recordCycleActive,
  recordPrunedOperationsCount,
  recordSyncAttemptFailed,
  recordSyncAttemptStarted,
  recordSyncAttemptSucceeded,
} from './sync-runtime-status.helpers';
import type {
  HeadlessSyncCycleProgress,
  HeadlessSyncCycleResult,
  HeadlessSyncCycleStage,
  RunHeadlessSyncCycleParams,
} from './headless-sync-cycle.types';
import type { SyncAttemptFailureDetail, SyncCycleStage } from './sync-runtime-status.types';

/**
 * Builds the failure message persisted for a cycle that never came back.
 *
 * The stage is spelled into the message rather than only into a column because this string is what
 * the Settings tile shows and what a log line carries: "abandoned at stage 'reconcile'" points at
 * the bridge round trip and its follow-up write, whereas a bare "background sync failed" sends the
 * next reader back to the device to find out where.
 */
export function buildAbandonedCycleMessage(
  stage: HeadlessSyncCycleStage,
  timeoutMs: number,
): string {
  return `Background sync cycle abandoned after ${timeoutMs}ms at stage '${stage}'`;
}

/** Translates one checkpoint via {@link HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE}. */
function toSyncCycleStage(stage: HeadlessSyncCycleStage): SyncCycleStage | null {
  return HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE[stage];
}

/**
 * Reads one field off a thrown value without assuming its shape.
 * Errors this module catches are not guaranteed to be a specific class (`LocalWriteError`,
 * a bridge client error, or a bare `Error`), so every field is read defensively rather than
 * through `instanceof` -- matching `anime-mutation-failure.helpers.ts`'s duck-typed reader, and
 * keeping this module decoupled from a concrete error export a test's mock module might omit.
 */
function readErrorShapeField(error: unknown, field: string): unknown {
  return typeof error === 'object' && error !== null && field in error
    ? (error as Record<string, unknown>)[field]
    : null;
}

/**
 * Classifies a caught cycle failure into the closed vocabularies `previous_cycle.*` reports.
 *
 * Reuses `sync-telemetry.helpers`'s normalizers rather than inventing a second taxonomy: an
 * out-of-vocabulary value collapses to the same `unknown`/`null` the read-side normalization
 * would already produce, instead of drifting into a value the bridge rejects with a `400`.
 */
function buildSyncAttemptFailureDetail(
  error: unknown,
  stage: HeadlessSyncCycleStage,
  cycleId: string | null,
): SyncAttemptFailureDetail {
  const rawErrorStage = readErrorShapeField(error, 'stage');

  return {
    cycleId,
    stage: toSyncCycleStage(stage),
    errorName: normalizeSyncCycleErrorName(error instanceof Error ? error.name : null),
    errorStage: normalizeSyncCycleErrorStage(
      typeof rawErrorStage === 'string' ? rawErrorStage : null,
    ),
    nativeErrcodeByte: normalizeNativeErrcodeByte(readErrorShapeField(error, 'errcode')),
  };
}

/**
 * Runs the cycle proper, publishing how far it got into `progress` as it goes.
 *
 * Progress is written to a shared object instead of being returned because the whole point of the
 * enclosing deadline is the case where this function never returns at all.
 */
async function runCycleBody(
  params: RunHeadlessSyncCycleParams,
  progress: HeadlessSyncCycleProgress,
): Promise<HeadlessSyncCycleResult> {
  progress.stage = 'open';
  const rawDb = await params.runtime.open();

  progress.stage = 'bridge_config';
  const bridgeConfig = await getBridgeConfigSnapshot(rawDb);

  if (!bridgeConfig?.deviceId) {
    return { kind: 'no_op', syncedCount: 0 };
  }

  // Captured BEFORE the two status writes below, and that ordering is the whole design: those
  // writes overwrite the very fields the post-mortem reads, so a snapshot taken after them would
  // describe THIS cycle and report every previous one as `never_closed`. Draining the diagnostic
  // ring here too means each batch of trouble is reported exactly once, on the next request that
  // is proven to leave the device.
  const telemetryContext: ReconcileTelemetryContext = {
    cycleId: createSyncCycleId(),
    triggerSource: params.triggerSource,
    appState: 'background',
    snapshot: await getSyncRuntimeStatusSnapshot(rawDb),
    recentEvents: drainDiagnosticEvents(),
  };

  // Stashed on `progress` (not only read from `telemetryContext` here) so `recordAbandonedCycle`
  // -- a separate function with no access to this closure -- can still correlate an abandoned
  // cycle with the request the bridge captured for it.
  progress.cycleId = telemetryContext.cycleId;

  const attemptedAt = Date.now();
  progress.attemptedAt = attemptedAt;

  progress.stage = 'attempt_started';
  await recordSyncAttemptStarted(
    rawDb,
    params.triggerSource,
    attemptedAt,
    telemetryContext.cycleId,
  );

  progress.stage = 'cycle_activated';
  await recordCycleActive(rawDb, true);

  try {
    // The headless/background runtime opens an isolated, non-reactive connection
    // (enableChangeListener:false, useNewConnection:true). It must apply pulled bridge
    // changes in 'staged' mode so the reconcile apply step never writes `animes` directly
    // on this connection -- only the foreground drain hook writes `animes`, on the shared
    // reactive connection, where `useLiveQuery` can observe it.
    progress.stage = 'reconcile';
    const { syncedCount, backlogReadCount } = await syncPendingOperations(
      rawDb,
      'staged',
      telemetryContext,
    );

    progress.stage = 'result_bookkeeping';
    await recordBacklogReadCount(rawDb, backlogReadCount);
    await recordSyncAttemptSucceeded(
      rawDb,
      params.triggerSource,
      attemptedAt,
      syncedCount,
      telemetryContext.cycleId,
    );

    try {
      progress.stage = 'prune';
      const pruneResult = await pruneOperationLog(rawDb);

      await recordPrunedOperationsCount(rawDb, pruneResult.prunedCount);
    } catch (pruneError) {
      console.warn('[runHeadlessSyncCycle] Operation-log pruning failed', pruneError);
    }

    return { kind: 'success', syncedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Background sync failed';

    // Recorded in memory first: the durable write below goes through the same door whose
    // jamming is the most common reason we are in this catch at all.
    recordDiagnosticEvent({
      source: 'sync_cycle',
      event: 'write_failed',
      cause: causeFromError(error),
      at: Date.now(),
    });

    await recordSyncAttemptFailed(
      rawDb,
      params.triggerSource,
      attemptedAt,
      message,
      buildSyncAttemptFailureDetail(error, progress.stage, telemetryContext.cycleId),
    );

    try {
      const pruneResult = await pruneOperationLog(rawDb);

      await recordPrunedOperationsCount(rawDb, pruneResult.prunedCount);
    } catch (pruneError) {
      console.warn('[runHeadlessSyncCycle] Operation-log pruning failed', pruneError);
    }

    return { kind: 'failed', syncedCount: 0 };
  } finally {
    await recordCycleActive(rawDb, false);
  }
}

/**
 * Persists why a cycle was abandoned and hands back the `is_cycle_active` flag it left held.
 *
 * The abandoned body is still running -- `withDeadline` bounds the caller's view, it cannot cancel
 * in-flight work -- so its own `finally` will not release anything on any schedule we control. This
 * runs on the connection the runtime still holds, under its own budget, because the jammed write
 * door that stranded the cycle can strand these two writes just as easily. Its failure is warned
 * about and swallowed: a recovery that throws would turn an abandoned cycle into an unhandled
 * rejection and lose the only outcome the caller can still be given.
 */
async function recordAbandonedCycle(
  params: RunHeadlessSyncCycleParams,
  progress: HeadlessSyncCycleProgress,
  timeoutMs: number,
): Promise<void> {
  const rawDb = params.runtime.rawDb;

  // `open` itself never completed, so there is no connection to write the explanation through.
  if (!rawDb) {
    return;
  }

  try {
    await withDeadline({
      operation: async () => {
        await recordSyncAttemptFailed(
          rawDb,
          params.triggerSource,
          progress.attemptedAt,
          buildAbandonedCycleMessage(progress.stage, timeoutMs),
          // No JS error was ever caught here -- the cycle simply never came back -- so only the
          // identity and stage are known; the error triple stays `null` rather than fabricating
          // a class or phase the abandoned cycle never actually reported.
          { cycleId: progress.cycleId, stage: toSyncCycleStage(progress.stage) },
        );
        await recordCycleActive(rawDb, false);
      },
      timeoutMs: params.recoveryDeadlineMs ?? HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS,
      label: 'headless_sync_cycle_recovery',
    });
  } catch (recoveryError) {
    console.warn('[runHeadlessSyncCycle] Abandoned-cycle recovery failed', recoveryError);
  }
}

/**
 * Runs one headless-safe sync cycle against the shared reconcile pipeline.
 * Both the Expo background task and the Android foreground service reuse this path so observability
 * stays consistent. The runtime owns the SQLite connection; this helper only borrows it for the
 * cycle duration.
 *
 * The cycle is bounded from the inside. An outer bound can only abandon it, and an abandoned cycle
 * leaves `is_cycle_active` set true forever, records no reason, and then keeps writing to a
 * connection its caller has already closed in a `finally` -- the "Access to closed resource" the
 * device reported. Bounding here means the cycle always resolves, always says which stage it
 * reached, and always hands the flag back before its caller tears the connection down.
 */
export async function runHeadlessSyncCycle(
  params: RunHeadlessSyncCycleParams,
): Promise<HeadlessSyncCycleResult> {
  const timeoutMs = params.deadlineMs ?? HEADLESS_SYNC_CYCLE_DEADLINE_MS;
  const progress: HeadlessSyncCycleProgress = {
    stage: 'open',
    attemptedAt: Date.now(),
    cycleId: null,
  };

  // Timer-liveness probe. A zero-delay timer must fire during the cycle's very first await; if
  // it has not fired by the end, the JS timer queue was PAUSED for the whole run -- which means
  // every deadline in this app, including the one wrapping this call, was inert. That single
  // fact explains a job that hangs until the host kills it with no JS output at all, and today
  // it is only observable through `adb logcat`. The probe is sound because the cycle always
  // awaits (open, config, HTTP) between scheduling and reading it.
  let didTimerFire = false;
  const livenessProbe = setTimeout(() => {
    didTimerFire = true;
  }, 0);

  try {
    return await withDeadline({
      operation: () => runCycleBody(params, progress),
      timeoutMs,
      label: 'headless_sync_cycle',
    });
  } catch (error) {
    // Only the budget is handled here. Everything the body itself can throw -- a failed open, an
    // unreadable bridge config, a jammed attempt write -- keeps propagating to the caller exactly
    // as before, because those are already terminal answers rather than silence.
    if (!(error instanceof DeadlineExceededError)) {
      throw error;
    }

    await recordAbandonedCycle(params, progress, timeoutMs);

    return { kind: 'failed', syncedCount: 0 };
  } finally {
    clearTimeout(livenessProbe);
    recordDiagnosticEvent({
      source: 'background_task',
      event: didTimerFire ? 'headless_task_registered' : 'headless_task_missing',
      at: Date.now(),
    });
  }
}
