# Exploration: Convergence Instrumentation

> Mirror of Engram topic `sdd/2026-09-09-convergence-instrumentation/explore` (observation 9255).

## Current State

**Diagnostics delivery works but is lossy.** `/api/sync/diagnostics` is a real, durable-outbox-backed endpoint (`src/features/sync/sync-diagnostics-flush.helpers.ts`, `src/infrastructure/db/sync-diagnostics-outbox/`); 5 captured requests, 4 rows server-side, all `204`s.

**Seven envelope fields are dead by construction.** `sync-runtime-status.helpers.ts:27-70` — `buildSyncAttemptStartedPatch`, `buildSyncAttemptSucceededPatch` and `buildSyncAttemptFailedPatch` write only `lastAttemptAt` / `lastFailureMessage` / `lastTriggerSource` / `lastSuccessAt` / `lastSyncedCount`. The merge (`mergeSyncRuntimeStatusPatch`, 175-223) and the upsert (`writeSyncRuntimeStatusRow`, 230-267) already carry `lastCycleId`, `lastCycleStage`, `lastErrorName`, `lastErrorStage`, `lastNativeErrcodeByte`, `lastCycleStageAt` and `consecutiveUnclosedCycles` — only the three builders never set them, so they stay `null`/`0` forever and every `previous_cycle.*` field on the wire (`sync-telemetry.helpers.ts:207-231`) is unreachable.

**`now` is never passed to `buildSyncCycleTelemetry`.** The sole production call site, `reconcile.helpers.ts:347-357`, omits it; `deriveElapsedMs` (`sync-telemetry.helpers.ts:130-136`) returns `null` whenever `now === undefined`, so `previous_cycle.elapsed_ms` stays unreachable even once the builders are fixed.

**Duplicate diagnostics delivery — the cause is the outbox `remove()` swallow, not a JobScheduler re-enqueue.** `sync-diagnostics-flush.helpers.ts:90-93` calls `store.remove(candidate.cycleId)` and then unconditionally `delivered += 1`; `sync-diagnostics-outbox.helpers.ts:100-106` wraps `runSync` in `try/catch { failedWriteCount += 1 }` and returns `void` either way, so a failed delete leaves the row for the next cycle to re-send. `getFailedWriteCount` has zero consumers anywhere in `src/` and is absent from the wire envelope.

The evidence separates this from the competing "JobScheduler kills at ~10 min and re-enqueues" theory in `background-sync-bounded-awaits`: the two captured requests were byte-identical and carried the **same** `cycle_id`, 600,055 ms apart. `createSyncCycleId()` is called fresh once per cycle (`headless-sync-cycle.helpers.ts:73`, backed by `Crypto.randomUUID`), so a genuine re-run after a scheduler kill would mint a **new** `cycle_id` and a fresh envelope, never a replay of the old one. A same-`cycle_id` byte-identical replay is exactly what an undeleted outbox row re-flushed by a later cycle produces.

**Convergence is never modelled.** No `converged` / `diverged` state exists anywhere in `src/`. "Caught up" is inferred ad hoc from `hasMorePending` (`reconcile.types.ts:45`), which drives only the in-cycle rerun loop (`sync-facade.helpers.ts:92`) and is never an observable state.

**`pending_ops_count` is a bounded-batch count, not queue depth.** `reconcile.constants.ts:10` sets `RECONCILE_BACKLOG_BATCH_LIMIT = 200`, bounding distinct animes (not rows) under `dedupeBy: 'anime_id'`. `reconcile.helpers.ts:327-329` separately computes `totalBacklogRowCount` purely to keep `hasMorePending` truthful; it is never surfaced on the wire.

**Terminal-failure states are invisible.** `operation-log-retention.types.ts:9-24` names three terminal statuses: `synced`, `dead_letter`, `conflict_exhausted`. Nothing counts or reports the latter two. `operation-log-retention.helpers.ts:27-34` (`countRowsForStatus`) is a reusable per-status `COUNT` primitive already used internally by pruning, but never called to build an observable metric. Retention TTL then deletes the rows, so the evidence of permanent data loss disappears on its own schedule.

**Two counters are already wired end to end, proving the pattern works.** `recordBacklogReadCount` / `recordPrunedOperationsCount` are called in production (`headless-sync-cycle.helpers.ts:103,115,138`), persisted through the same runtime-status singleton, read by `use-background-sync-status.ts:57-58` and rendered in `settings-screen.helpers.ts:125-126`. They simply never reach the bridge envelope.

## Cross-Check Against Existing SDD Changes

1. **`background-sync-bounded-awaits`** (proposal + design + specs + tasks, all checkboxes `[ ]`): the fix has shipped. `withDeadline` (`src/infrastructure/async/deadline.helpers.ts`), `BridgeRequestSpec.timeoutMs` (`bridge-client.types.ts:48`) and `HEADLESS_SYNC_CYCLE_DEADLINE_MS = 35_000` (`headless-sync-cycle.constants.ts:17`) are all present and wired; commit `fbe3d3f` matches. `tasks.md` still shows 0 completed — confirmed checkbox/code drift. This does not change scope here; it only means the JobScheduler-kill explanation must not be assumed, since the code that would produce it no longer runs unbounded.

2. **`durable-reconcile-footprint`** (proposal only) — **A10 is already fixed**, contradicting the assumption that it still reproduces. `apply-remote-changes.helpers.ts:27-43` runs the existence check unconditionally, and its comment states it "used to sit inside the `changed_fields.length === 0` branch". `tests/behaviour/sync/inbound-changes.behaviour.test.ts:100` contains a test named `'A10 FIXED: an update with changed_fields for an unknown _id is upserted, not dropped'`. **A10 is not a blocker.** R2 (the "one transaction for cursor + confirmation" half of that proposal) was **not** verified in this session and must not be assumed either way.

3. **`sync-trace-observability`** (proposal only) — the `X-Sync-Cycle-Id` header is **not** implemented; `BridgeRequestSpec` has no correlation field. What ships today is `cycle_id` inside the diagnostics envelope **body** (`sync-telemetry.helpers.ts:213`). **This change must not own the header**: it belongs to `sync-trace-observability`, which requires a native-module rebuild (`getElapsedRealtime` / `getUptimeMillis`) anyway. Deferring avoids two changes racing to add the same field.

4. **Checkbox drift** is confirmed on both `background-sync-bounded-awaits/tasks.md` and `core-sync-behaviour-suite/tasks.md`: every task unchecked despite merged code. Pre-existing, outside this change's scope, and explicitly not to be reconciled here.

## Affected Areas

- `src/features/sync/sync-runtime-status.helpers.ts:27-70` — the three patch builders that must start writing the seven dead fields
- `src/features/sync/reconcile.helpers.ts:340-358` — the `buildSyncCycleTelemetry` call site missing `now`
- `src/features/sync/sync-diagnostics-flush.helpers.ts:88-99` — the `remove()` call whose failure is swallowed and miscounted as delivered
- `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.helpers.ts:100-106` — `remove()` returns `void` on failure; `getFailedWriteCount` is unconsumed
- `src/features/sync/operation-log-retention.helpers.ts:27-34` — `countRowsForStatus`, the per-status count primitive a convergence projection can reuse
- `src/features/sync/reconcile.constants.ts:10` and `reconcile.helpers.ts:327-329` — the bounded-batch versus true-backlog-depth distinction a convergence signal must not blur
- `src/features/settings/ui/SettingsScreen/settings-screen.helpers.ts`, `src/features/settings/use-background-sync-status.ts` — the existing consumer pattern for runtime-status counters. **No new screen is needed.**

## Approaches

1. **Incremental fix-in-place.** Extend the three patch builders, pass `now`, make `remove()` report success or failure so the flush counts `delivered` only on a confirmed delete, and add an `operation_log` convergence projection reusing `countRowsForStatus` per status.
   - Pros: every piece has an already-shipped analog in this codebase; no new screen and no wire-format redesign; testable one helper at a time under the TDD mandate.
   - Cons: additive to an already-large envelope; the projection needs a new query rather than a read of existing state.
   - Effort: Medium.

2. **A unified `sync-convergence` feature owning a wire-format redesign (tolerant reader).** Explicitly out of scope for this change (open body and cross-repo vocabulary codegen were ruled out up front). Not evaluated further.

## Recommendation

Approach 1, with two adjustments:

- Do **not** add an `X-Sync-Cycle-Id` header in this change; defer to `sync-trace-observability`.
- Treat R2 from `durable-reconcile-footprint` as an open dependency **only** if the convergence signal needs cursor-advance atomicity to be trustworthy. R2's current status is unverified.

## Risks

- R2 (one-transaction cursor + confirmation) status is unverified; re-check before design if convergence semantics depend on "cursor advanced equals operations confirmed" being atomic.
- `background-sync-bounded-awaits` and `core-sync-behaviour-suite` have merged code with stale `tasks.md`; a later archive pass could mistake them for pending dependencies.
- Fixing `remove()`'s acknowledgement semantics changes the meaning of `SyncDiagnosticsFlushResult.delivered`. Enumerate every caller and test asserting the old, inflated count first.
- The `dharness/*` JSDoc lint debt on every touched file becomes this change's responsibility (CLAUDE.md constraint 12).

## Ready for Proposal

Yes. Scope is coherent and code-verified; no hard blockers. Three facts to carry forward: A10 is already fixed; the diagnostics duplicate is best explained by the outbox `remove()` swallow; and two prior changes have code-complete work with stale checkboxes (informational, not blocking).
