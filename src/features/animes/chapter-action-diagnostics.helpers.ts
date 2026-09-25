import * as Crypto from 'expo-crypto';
import { syncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { isSyncDiagnosticsPayloadAccepted } from '../sync/sync-diagnostics-flush.helpers';
import { SYNC_CYCLE_ERROR_CAUSES } from '../sync/sync-telemetry.constants';
import { causeFromError } from '../sync/sync-telemetry.helpers';
import { isSyncTelemetryEnabled } from '../sync/sync-telemetry-preference.helpers';
import {
  CHAPTER_ACTION_EVENT_KIND,
  CHAPTER_ACTION_OPTIONAL_FIELDS,
  CHAPTER_ACTION_PHASE_OUTCOMES,
  CHAPTER_ACTION_PHASES,
  CHAPTER_ACTION_SKIPPED_REASONS,
  CHAPTER_ACTION_WIRE_ACTIONS,
} from './chapter-action-diagnostics.constants';
import type {
  ChapterActionContext,
  ChapterActionDiagnosticsParams,
  ChapterActionLabel,
  ChapterActionObservation,
  ChapterActionOptionalField,
  ChapterActionOutcome,
  ChapterActionPhase,
  ChapterActionSkippedReason,
  ChapterActionSyncOutcome,
  ChapterActionWirePayload,
} from './chapter-action-diagnostics.types';

/**
 * The phase-specific half of a payload: the duration every phase must state, plus the fields only
 * some phases may add.
 *
 * `duration_ms` is REQUIRED here rather than optional because the bridge expects the key on every
 * body -- `null` is how a phase says "not applicable" -- so a phase that forgot it would answer
 * with a rejection instead of an omission. Making it non-optional means a new phase cannot compile
 * until it has decided what to say.
 */
type ChapterActionWireFields = Pick<ChapterActionWirePayload, 'duration_ms'> &
  Partial<Pick<ChapterActionWirePayload, 'outcome' | 'reason' | 'cause'>>;

/**
 * Generates one id when no generator was injected.
 *
 * Backed by `expo-crypto`'s platform CSPRNG rather than `Math.random`, for the same reason
 * `createSyncCycleId` is: two observations that collide would merge two gestures into one
 * correlation, and that wrong answer reads exactly like a valid one.
 */
function generateChapterActionId(): string {
  return Crypto.randomUUID();
}

/**
 * Resolves the recorder's gate from the value a caller injected, or from nothing at all.
 *
 * Routed through the switch's own predicate rather than a hand-written `?? true`: "absent means
 * enabled" is a decision with a written rationale (a device that never opened Settings must still
 * report the failure it hit), and a second copy of that rule here would be a second place for the
 * two answers to drift apart. It also gives the injected value the predicate's own safety
 * property: anything that is not an explicit `true` -- garbage a cast let through, a string, a
 * number -- mutes the channel instead of opening it.
 */
function resolveChapterActionTelemetryEnabled(injected: boolean | undefined): boolean {
  return isSyncTelemetryEnabled({ isSyncTelemetryEnabled: injected });
}

/**
 * Narrows a runtime value to a member of a closed vocabulary.
 *
 * The value reaching this helper usually came from `as`-cast test input or from a caller that
 * passed something the compiler could not see. Comparing against the vocabulary is what keeps the
 * privacy promise: anything not named in a constants file cannot reach the payload.
 */
function isVocabularyMember<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}

/** Narrows a string to one of the four chapter gestures that have a stable wire token. */
function isWireActionLabel(value: string): value is ChapterActionLabel {
  return Object.prototype.hasOwnProperty.call(CHAPTER_ACTION_WIRE_ACTIONS, value);
}

/**
 * True when a duration is a usable measurement rather than a negative, infinite, or non-numeric
 * value. A rejected duration drops its whole observation instead of being coerced to a number,
 * because a coerced `NaN` would serialize as `null` and read as a real measurement of nothing.
 */
function isUsableDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * True when an observation carries a phase-specific field that does not belong to its phase.
 *
 * The phases are not interchangeable: a `sync` result carries no duration, and a `skipped` action
 * carries no outcome. Rather than trusting each caller, this makes the emitted shape the only
 * shape -- a field out of place drops the observation instead of riding along.
 */
function carriesForeignFields(
  observation: ChapterActionObservation,
  allowed: readonly ChapterActionOptionalField[],
): boolean {
  return CHAPTER_ACTION_OPTIONAL_FIELDS.some(
    (field) => observation[field] !== undefined && !allowed.includes(field),
  );
}

/**
 * The SINGLE cross-field rule pairing `outcome` with `phase`.
 *
 * Returns the token when the pair is declared and null when it is not, which covers both ways a
 * body can break the rule: an `outcome` the phase does not declare (`committed` on a `sync`, `ok`
 * on a `finished`), and an `outcome` on a phase that declares none at all (`received` and
 * `skipped`, whose vocabulary is empty). A mismatch is refused, never repaired, because the bridge
 * answers a rejection for it and this payload is stored verbatim before it is ever POSTed.
 */
function resolvePhaseOutcome(
  phase: ChapterActionPhase,
  outcome: ChapterActionOutcome | undefined,
): ChapterActionOutcome | null {
  const vocabulary: readonly ChapterActionOutcome[] = CHAPTER_ACTION_PHASE_OUTCOMES[phase];

  return isVocabularyMember(outcome, vocabulary) ? outcome : null;
}

/**
 * Fields a `received` observation contributes: none, and an explicit "no duration".
 *
 * Receipt is the bare fact that the callback ran, so anything phase-specific here means a caller
 * conflated two milestones -- dropped rather than forwarded, like every other out-of-place value.
 */
function buildReceivedFields(observation: ChapterActionObservation): ChapterActionWireFields | null {
  return carriesForeignFields(observation, []) ? null : { duration_ms: null };
}

/** Fields a `skipped` observation contributes: the closed reason the action produced no change. */
function buildSkippedFields(observation: ChapterActionObservation): ChapterActionWireFields | null {
  if (carriesForeignFields(observation, ['reason'])) {
    return null;
  }

  return isVocabularyMember(observation.reason, CHAPTER_ACTION_SKIPPED_REASONS)
    ? { reason: observation.reason, duration_ms: null }
    : null;
}

/**
 * Fields a `finished` observation contributes: its outcome, the closed cause of a failure, and the
 * measured duration.
 *
 * The duration is measured here from the observation's `observedAtMs` and the context's `startedAt`
 * when the caller supplied none, so the measurement and the timestamp it is reported against come
 * from the same clock read; a caller-supplied value is still honored, but validated like any other.
 *
 * `committed` and `failed` are not symmetric: only a failure carries a cause, because "which fix
 * applies" is meaningless for a write that landed -- and a cause on a committed write is answered
 * with a rejection rather than ignored, so it drops the observation instead of riding along.
 */
function buildFinishedFields(
  context: ChapterActionContext,
  observation: ChapterActionObservation,
  observedAtMs: number,
): ChapterActionWireFields | null {
  if (carriesForeignFields(observation, ['outcome', 'cause', 'durationMs'])) {
    return null;
  }

  const outcome = resolvePhaseOutcome(observation.phase, observation.outcome);
  if (outcome === null) {
    return null;
  }

  const durationMs = observation.durationMs ?? observedAtMs - context.startedAt;
  if (!isUsableDuration(durationMs)) {
    return null;
  }

  if (outcome === 'committed') {
    return observation.cause === undefined
      ? { outcome: 'committed', duration_ms: durationMs }
      : null;
  }

  if (outcome === 'failed') {
    return isVocabularyMember(observation.cause, SYNC_CYCLE_ERROR_CAUSES)
      ? { outcome: 'failed', cause: observation.cause, duration_ms: durationMs }
      : null;
  }

  return null;
}

/**
 * Fields a `sync` observation contributes: its outcome, and an explicit "no duration".
 *
 * The push is fire-and-forget, so a duration captured here would measure how long the enqueue took
 * rather than how long the transfer took -- an answer to neither question. The key still has to be
 * present, so this phase says `null` rather than omitting it; a real duration arriving on this
 * phase is a field out of place, and drops the observation.
 */
function buildSyncFields(observation: ChapterActionObservation): ChapterActionWireFields | null {
  if (carriesForeignFields(observation, ['outcome'])) {
    return null;
  }

  const outcome = resolvePhaseOutcome(observation.phase, observation.outcome);

  return outcome === null ? null : { outcome, duration_ms: null };
}

/**
 * Dispatches one observation to the builder that owns its phase.
 *
 * One function per phase, each returning null for anything out of contract, so every phase's
 * rules are readable in isolation and an unknown phase has exactly one way to be rejected.
 */
function buildPhaseFields(
  context: ChapterActionContext,
  observation: ChapterActionObservation,
  observedAtMs: number,
): ChapterActionWireFields | null {
  if (observation.phase === 'received') {
    return buildReceivedFields(observation);
  }

  if (observation.phase === 'skipped') {
    return buildSkippedFields(observation);
  }

  if (observation.phase === 'finished') {
    return buildFinishedFields(context, observation, observedAtMs);
  }

  if (observation.phase === 'sync') {
    return buildSyncFields(observation);
  }

  return null;
}

/**
 * Builds the exact payload for one observation, or null when any part of it is out of contract.
 *
 * Returns null rather than a repaired payload: this function is the single gate between an
 * in-memory observation and a row that will be POSTed, stored verbatim, and copied into backups.
 * A dropped observation is a missing data point; a forwarded one is permanent.
 *
 * Exported because it IS the frozen wire contract, and a contract that can only be reached through
 * the four recorders cannot be exercised for the phase and field combinations those recorders are
 * built never to produce -- a cause on a committed write, a reason outside a skip, a duration off
 * a finished write. `emitChapterAction` remains its only production caller.
 */
export function buildChapterActionWirePayload(
  context: ChapterActionContext,
  observation: ChapterActionObservation,
  observedAtMs: number,
  observationId: string,
): ChapterActionWirePayload | null {
  if (observation.action !== context.action) {
    return null;
  }

  if (!isWireActionLabel(observation.action)) {
    return null;
  }

  if (!isVocabularyMember(observation.phase, CHAPTER_ACTION_PHASES)) {
    return null;
  }

  const phaseFields = buildPhaseFields(context, observation, observedAtMs);
  if (phaseFields === null) {
    return null;
  }

  return {
    kind: CHAPTER_ACTION_EVENT_KIND,
    observation_id: observationId,
    action: CHAPTER_ACTION_WIRE_ACTIONS[observation.action],
    phase: observation.phase,
    observed_at_ms: observedAtMs,
    correlation_id: context.correlationId,
    ...phaseFields,
  };
}

/**
 * Persists one observation into the durable diagnostics outbox, best-effort.
 *
 * The outbox is the ONLY capture for these observations: the in-memory diagnostics ring is
 * volatile and is not what the bridge receives, so routing here is what makes the answer survive
 * the process that produced it. The clock is read once so the payload's `observed_at_ms` and any
 * duration derived from it describe the same instant, and the write is swallowed by contract -- the
 * store already never throws, and instrumentation must never be the reason a user mutation fails.
 *
 * ONE id is minted per observation and used twice: the outbox row's own id and the payload's
 * `observation_id`. The bridge deduplicates on that id, so the two must be the same value -- a
 * stored body re-posted after a restart has to carry the id that was stored WITH it, which is why
 * the id is generated before the payload is built rather than by the `enqueue` call.
 *
 * Gated FIRST on the action's resolved switch position, before the clock is read and before any
 * payload is built: while the user's telemetry is off this returns without observing anything, so
 * no phase of the action can reach the outbox -- not a receipt, not a redacted or partial row.
 *
 * Gated LAST on the bridge actually accepting the payload the builder just produced, and never on a
 * copy of that decision: the diagnostics endpoint strict-decodes its body and answers 400 for a
 * `kind` it does not declare, while the flush reads a 400 as a permanent rejection and deletes the
 * row. Writing such a row would be writing something the system is designed to destroy, so with no
 * accepted kind in the registry this returns before the `enqueue` and every phase stays silent.
 * The day the bridge ships a kind, the registry entry is the only thing that has to change here.
 */
function emitChapterAction(
  context: ChapterActionContext,
  observation: ChapterActionObservation,
  params: ChapterActionDiagnosticsParams,
): void {
  if (!context.isTelemetryEnabled) {
    return;
  }

  const observedAtMs = (params.now ?? Date.now)();
  const observationId = (params.generateId ?? generateChapterActionId)();
  const payload = buildChapterActionWirePayload(
    context,
    observation,
    observedAtMs,
    observationId,
  );
  if (payload === null) {
    return;
  }

  if (!isSyncDiagnosticsPayloadAccepted(payload)) {
    return;
  }

  try {
    (params.store ?? syncDiagnosticsOutboxStore).enqueue({
      cycleId: observationId,
      payload: JSON.stringify(payload),
    });
  } catch {
    // Swallowed by contract: a telemetry failure must never replace the mutation's own outcome.
  }
}

/**
 * Opens one chapter action's diagnostic thread and records that its JS callback ran.
 *
 * Called at the callback boundary -- before any guard, any write, and any await -- because that is
 * the only place that can answer "did the tap reach JS at all". A button that is disabled never
 * reaches here, and neither does a tap consumed by a dead JS thread: those two cases are
 * indistinguishable from the device precisely because nothing upstream of this call runs.
 *
 * The correlation id is generated first and shared by every later observation of this action, so
 * two sequential presses stay separable even when their outcomes are identical. The user's
 * telemetry preference is resolved here, once, for the same reason: it is a property of the action
 * this call opens, and every later phase reads it off the context instead of re-deciding.
 */
export function beginChapterAction(
  action: ChapterActionLabel,
  params: ChapterActionDiagnosticsParams = {},
): ChapterActionContext {
  const context: ChapterActionContext = {
    action,
    correlationId: (params.generateId ?? generateChapterActionId)(),
    startedAt: (params.now ?? Date.now)(),
    isTelemetryEnabled: resolveChapterActionTelemetryEnabled(params.isTelemetryEnabled),
  };

  emitChapterAction(context, { action, phase: 'received' }, params);

  return context;
}

/**
 * Records that the local write landed, with the elapsed time measured from receipt.
 *
 * `committed` means the row update AND its pending operation landed together in one transaction:
 * that is the answer to "was it lost locally", and it is deliberately not derived from the
 * mutation promise resolving, which cannot distinguish a write from a silent no-op.
 */
export function recordChapterActionCommitted(
  context: ChapterActionContext,
  params: ChapterActionDiagnosticsParams = {},
): void {
  emitChapterAction(
    context,
    { action: context.action, phase: 'finished', outcome: 'committed' },
    params,
  );
}

/**
 * Records that the local write failed, carrying only the closed cause of the failure.
 *
 * The thrown error itself never travels: on Android its message carries the database path, SQL
 * fragments, and the bound values -- which in this app are anime titles. Classification happens
 * here, so the fix-facing symbol crosses the wire and the text stays on the device.
 */
export function recordChapterActionFailed(
  context: ChapterActionContext,
  error: unknown,
  params: ChapterActionDiagnosticsParams = {},
): void {
  emitChapterAction(
    context,
    {
      action: context.action,
      phase: 'finished',
      outcome: 'failed',
      cause: causeFromError(error) ?? 'unknown',
    },
    params,
  );
}

/**
 * Records that the action produced no local change, and why.
 *
 * Separated from a failure on purpose: a dropped tap and a rejected write look identical to the
 * user (nothing happens) and have opposite diagnoses. `in_flight` is the list screen's same-anime
 * guard; `anime_missing` is the mutation finding no row to update; `db_unavailable` is the mutation
 * hook finding no SQLite context at all, so the write door never opened.
 */
export function recordChapterActionSkipped(
  context: ChapterActionContext,
  reason: ChapterActionSkippedReason,
  params: ChapterActionDiagnosticsParams = {},
): void {
  emitChapterAction(context, { action: context.action, phase: 'skipped', reason }, params);
}

/**
 * Records how the fire-and-forget push that follows a committed write ended.
 *
 * This is the fourth question, and the one the device could not answer before: the local write
 * landed (so the user's data is safe) but the bridge never received it. It carries no duration,
 * because the push is not awaited -- a duration captured here would measure the enqueue, not the
 * transfer, and would answer neither question.
 */
export function recordChapterActionSync(
  context: ChapterActionContext,
  outcome: ChapterActionSyncOutcome,
  params: ChapterActionDiagnosticsParams = {},
): void {
  emitChapterAction(context, { action: context.action, phase: 'sync', outcome }, params);
}
