# Apply Progress: Convergence Instrumentation

## Phase 1: Cycle Identity & Stage Persistence — DONE

- [x] 1.1 RED `tests/features/sync/__tests__/sync-runtime-status.helpers.test.ts`
- [x] 1.2 GREEN `sync-runtime-status.helpers.ts` + `sync-runtime-status.types.ts`
- [x] 1.3 MUTATE — error-triple clear in `buildSyncAttemptStartedPatch`, guard confirmed, restored from index

### What changed

- `buildSyncAttemptStartedPatch(triggerSource, attemptedAt, previous, cycleId = null)`: now sets
  `lastCycleId`, `lastCycleStage: 'attempt_started'`, `lastCycleStageAt`, clears the error triple
  to explicit `null`, and derives `consecutiveUnclosedCycles` from `previous.isCycleActive`.
- `buildSyncAttemptSucceededPatch(triggerSource, attemptedAt, syncedCount, cycleId = null)`: sets
  `lastCycleStage: 'closed'`, `lastCycleStageAt`, clears the error triple, resets
  `consecutiveUnclosedCycles` to 0.
- `buildSyncAttemptFailedPatch(triggerSource, attemptedAt, message, detail = {})`: new
  `SyncAttemptFailureDetail` (`cycleId?`, `stage?`, `errorName?`, `errorStage?`,
  `nativeErrcodeByte?`, all optional, default `null`) sets the stage/error triple instead of
  fabricating one when the caller cannot classify the failure.
- `sync-runtime-status.types.ts`: `SyncRuntimeStatusPatch.lastErrorName`/`lastErrorStage` narrowed
  to `SyncCycleErrorName | null` / `SyncCycleErrorStage | null` (imported from
  `sync-telemetry.types.ts`); `SyncRuntimeStatusSnapshot` kept as `string | null` per D4. New
  exported `SyncAttemptFailureDetail` interface.
- `recordSyncAttemptStarted`/`recordSyncAttemptSucceeded`/`recordSyncAttemptFailed` gained
  trailing OPTIONAL parameters that thread through to the builders. Every existing call site
  (`headless-sync-cycle.helpers.ts`, `sync-facade.helpers.ts`,
  `notifee-foreground-service-adapter.helpers.ts`, `anime-mutation.helpers.ts`) compiles and
  behaves unchanged — none of the seven fields were ever written before this change (confirmed by
  grep), so persisting an explicit `null` where a caller omits the new parameter is not a
  regression.
- Moved `tests/features/sync/sync-runtime-status.helpers.test.ts` to
  `tests/features/sync/__tests__/sync-runtime-status.helpers.test.ts` (this was a pre-existing
  convention violation of CLAUDE.md #3; fixed as a side effect of a required edit to that file,
  not a bulk pass) and extended it with the acceptance scenarios plus a vocabulary golden test for
  `SYNC_CYCLE_STAGES` / `SYNC_CYCLE_ERROR_NAMES` / `SYNC_CYCLE_ERROR_STAGES`.

### Known gap (risk, not fixed here — out of Phase 1's file scope)

None of the five phases in `tasks.md` assign wiring the SAME `cycleId` (and the real
`HeadlessSyncCycleStage`/error classification) from `headless-sync-cycle.helpers.ts` into these
three calls. Until that wiring lands, `lastCycleId`/`lastCycleStage`/error-triple stay `null` in
production even though the pure builders now support carrying them — the correlation this whole
change exists for (`previous_cycle.cycle_id` matching what the prior cycle actually reported)
does not close end-to-end yet. Flagged for the orchestrator to route to a follow-up task.

### Verification

- `npx jest tests/features/sync/__tests__/sync-runtime-status.helpers.test.ts` — 18/18 passed
- `npm test` (full suite) — 149 suites / 1017 tests passed
- `npx tsc --noEmit` — exit 0, no errors
- `npx eslint --max-warnings=0 --no-warn-ignored <touched files>` — clean (fixed one
  `dharness/require-variable-jsdoc` finding on the new test fixture constant)
- Mutation: deleted the error-triple clear (3 lines) in `buildSyncAttemptStartedPatch` after
  staging the green feature; the guarded test
  (`buildSyncAttemptStartedPatch limpia error previo y registra trigger+attempt`) failed as
  expected (deep-equality diff missing `lastErrorName`/`lastErrorStage`/`lastNativeErrcodeByte`);
  restored via `git checkout -- src/features/sync/sync-runtime-status.helpers.ts` (index
  restore, not `HEAD`).

Not committed — per this project's rule, the orchestrator owns commit + final verification.

## Phase 1b: Wire Real Cycle Values Into The Recorders — DONE

- [x] 1b.1 RED `tests/features/sync/__tests__/headless-sync-cycle.helpers.test.ts` (moved from
  `tests/features/sync/` root, the same pre-existing `__tests__` convention violation Phase 1
  fixed for `sync-runtime-status.helpers.test.ts`)
- [x] 1b.2 GREEN `headless-sync-cycle.{helpers,types,constants}.ts`
- [x] 1b.3 MUTATE — dropped the `cycleId` argument at the start call site, guard confirmed, restored from index

### What changed

- `headless-sync-cycle.helpers.ts` now mints `createSyncCycleId()` once per cycle
  (`telemetryContext.cycleId`) and threads that SAME id into `recordSyncAttemptStarted`,
  `recordSyncAttemptSucceeded`, and every `recordSyncAttemptFailed` call (both the in-cycle catch
  and the deadline-abandoned path).
- New `buildSyncAttemptFailureDetail(error, stage, cycleId)`: classifies a caught failure using
  the EXISTING `sync-telemetry.helpers.ts` normalizers (`normalizeSyncCycleErrorName`,
  `normalizeSyncCycleErrorStage`, `normalizeNativeErrcodeByte`) — no second taxonomy. Reads
  `error.name`/`.stage`/`.errcode` defensively (`readErrorShapeField`, duck-typed like
  `anime-mutation-failure.helpers.ts`'s `readLocalWriteFailureDiagnostics`), not via `instanceof`,
  so it degrades safely regardless of which error class was thrown.
- `HeadlessSyncCycleProgress` gained a `cycleId: string | null` field so `recordAbandonedCycle` —
  a separate function with no access to `runCycleBody`'s closure — can still correlate an
  abandoned cycle with its request.
- New `HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE` (in `headless-sync-cycle.constants.ts` — a `.helpers.ts`
  file may not declare a value, `dharness/role-file-shape`) maps the 7-member
  `HeadlessSyncCycleStage` onto the 11-member `SyncCycleStage` wire vocabulary: `open`, `config`
  (renamed from `bridge_config`'s mapping), `attempt_started`, `cycle_activated`, and `prune`
  translate directly; `reconcile` reports `http`, `result_bookkeeping` reports `apply_write`.

### Correction after orchestrator review: null, not an approximation

The first pass of this phase mapped `reconcile`->`http` and `result_bookkeeping`->`apply_write` as
representative approximations. The orchestrator rejected this: `reconcile` spans `backlog_read`,
`claim_ops`, `http`, `parse_response` AND `apply_write` (including local SQLite writes through
`withLocalWrite`), so reporting `http` for a local write-door jam inside reconcile would misreport
it as a transport failure — reintroducing the exact false-answer defect class this change exists
to remove (the `consecutive_unclosed_cycles` reading `0` beside three `never_closed` outcomes case
study). Corrected: `HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE` now maps only the five EXACT
correspondences (`open`, `bridge_config`->`config`, `attempt_started`, `cycle_activated`, `prune`)
and returns `null` for `reconcile` and `result_bookkeeping` — the wire vocabulary has no `unknown`
member, so `null` is the only honest "not known". The diagnosis is not lost: the error triple
(`error_name`/`error_stage`/`error_cause`) still fires on that same failure path and is the surface
actually designed to discriminate. Recorded as design.md Decision D7, with the rejected
approximation and a documented (not scheduled) follow-up: publishing real checkpoints from
`reconcile.helpers.ts` would let those two report an exact sub-stage instead of `null`.

Test file also split: `headless-sync-cycle.helpers.test.ts` grew past the 500-line rule, so the
hard-deadline/abandoned-cycle behavior and `buildAbandonedCycleMessage` moved to a new sibling
`headless-sync-cycle-deadline.test.ts` (356 + 272 lines).

### Verification (post-correction)

- `npx jest tests/features/sync/__tests__/headless-sync-cycle.helpers.test.ts
  tests/features/sync/__tests__/headless-sync-cycle-deadline.test.ts` — 16/16 passed across both
  files
- `npm test` (full suite) — 150 suites / 1020 tests passed (baseline 1017; +1 suite from the
  500-line split, +3 net new cases: null-stage-on-bare-Error-failure,
  null-stage-on-LocalWriteError-failure, null-stage-on-result-bookkeeping-failure)
- `npx tsc --noEmit` — exit 0
- `npx eslint --max-warnings=0 --no-warn-ignored <touched files>` — clean (stage-mapping constant
  lives in `.constants.ts` per `dharness/role-file-shape`; every new function carries its own
  JSDoc; test file split keeps both files under `dharness/max-file-lines`)
- Mutation: staged the green feature, dropped `telemetryContext.cycleId` from the
  `recordSyncAttemptStarted` call site, ran only
  `-t "persists attempt and success"` — failed with a diff missing `"cycle-fixed-id"` as
  expected; restored via `git checkout -- src/features/sync/headless-sync-cycle.helpers.ts`
  (index restore, confirmed clean and green again afterward)

`previous_cycle.cycle_id`/`.last_stage`/error triple now reach the wire with real values on every
attempt lifecycle transition. `consecutiveUnclosedCycles` wiring was already correct since Phase 1
(it reads the previous snapshot inside `recordSyncAttemptStarted` itself, independent of the
cycle-id parameter); this phase only added a regression guard proving that behavior is undisturbed
by the new argument.

Not committed — orchestrator owns commit + final verification.

## Phase 3: Diagnostics Delivery Outcome — DONE

- [x] 3.1 RED `tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts`
- [x] 3.2 GREEN `sync-diagnostics-outbox.{types,helpers}.ts`; `buildFakeStore` updated
- [x] 3.3 RED `tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts`
- [x] 3.4 GREEN `sync-diagnostics-flush.{types,helpers}.ts` + `reconcile.{types,helpers}.ts`
- [x] 3.5 MUTATE — deleted the `isEnvelopeRejection` check; confirmed 3 tests fail; restored from index

### What changed

- `sync-diagnostics-outbox.types.ts`: new `SyncDiagnosticsOutboxWriteOutcome = 'removed' | 'failed'`;
  `SyncDiagnosticsOutboxStore.remove` now returns it instead of `void`.
- `sync-diagnostics-outbox.helpers.ts`: `remove()` returns `'removed'` after a successful
  `runSync`, `'failed'` from the existing `catch` (which still increments `failedWriteCount` —
  the swallow contract is untouched, per design.md D2). RED for the `'failed'` case forced a new
  technique: `getNativeHandle(opener.adapter).close()` on the real `node:sqlite` handle after one
  successful `enqueue`, so the store's cached connection is still truthy (`connect()` skips
  reopening) and the next `runSync` throws for real — no existing test in this file exercised a
  post-connect throw.
- `sync-diagnostics-flush.types.ts`: `SyncDiagnosticsFlushResult` gained `discarded` and
  `failedRemovals` (design.md D3).
- `sync-diagnostics-flush.helpers.ts`: the 2xx branch now counts `delivered` only when
  `store.remove(...) === 'removed'`, else `failedRemovals`; the `isEnvelopeRejection` branch
  now also increments `discarded`.
- `reconcile.types.ts`: `SyncPendingOperationsResult` gained `diagnosticsFlush: SyncDiagnosticsFlushResult`.
- `reconcile.helpers.ts`: `performSyncPendingOperations` captures `flushSyncDiagnosticsOutbox`'s
  return value into `diagnosticsFlush` (previously discarded) and returns it. The OUTER
  `syncPendingOperations` wrapper's rerun loop (`run()`) also builds a full
  `SyncPendingOperationsResult` literal — a second construction site D2's inventory did not name —
  so it now tracks `diagnosticsFlush` across iterations the same way it already tracked
  `hasMorePending`: last batch wins, not accumulated (a rerun re-reads whatever the outbox holds
  at that moment).

### Drift found beyond D2's inventory — reported as asked

D2's caller/assertion inventory named `reconcile.helpers.test.ts:18` and
`reconcile-diagnostics-wiring.test.ts:19` as the two stubs needing the new counters, both
confirmed present and updated. It did **not** name two more real breakages, both in
`tests/features/sync/use-reconcile.test.ts`: that file does not mock
`sync-diagnostics-flush.helpers` at all, so `syncPendingOperations` runs the REAL
`flushSyncDiagnosticsOutbox` (against a store that fails to connect and returns `[]`, so it's
inert) and its two `expect(result).toEqual({ syncedCount, backlogReadCount, hasMorePending })`
assertions (lines 138, 329) are exact-shape checks that fail the moment `diagnosticsFlush`
becomes a real field. Both updated to include
`diagnosticsFlush: { attempted: 0, delivered: 0, discarded: 0, failedRemovals: 0 }`. Also verified
the outer rerun-loop `run()` construction site above — the second literal that needed the field
threaded through it to keep `tsc` clean — since D2 didn't mention it either. Checked, and ruled
out as unaffected: `sync-facade.helpers.ts`, `use-reconcile.ts` (production consumers only
destructure the fields they use), and every other test that mocks `syncPendingOperations`/
`reconcile.helpers` wholesale (`use-sync-facade.test.ts`, `sync-facade-failure-precedence.test.ts`,
`use-sync-facade-connection-truth.test.ts`, `anime-mutation-connection.test.ts`) — untyped
`jest.fn()` mocks with local, decoupled result types, so an added required field on the real
interface cannot break them.

### Mutation (3.5)

Staged the green `sync-diagnostics-flush.helpers.ts`, deleted the `isEnvelopeRejection` guard
(the 400/413/422 branch), ran the full flush suite: exactly the 3 tests naming that malformed-
envelope family failed (`removes the row and continues on a 400/413/422`, each expecting 2 POSTs
and a `discarded` count that the mutated code — now falling into the generic transient-failure
branch and `break`ing the batch after 1 POST — could no longer produce). Restored via
`git checkout -- src/features/sync/sync-diagnostics-flush.helpers.ts` (index restore).

### Verification

- `npx jest tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts
  tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts` — 28/28 passed
- `npx jest tests/features/sync/reconcile.helpers.test.ts
  tests/features/sync/reconcile-diagnostics-wiring.test.ts tests/features/sync/use-reconcile.test.ts
  tests/features/sync/use-sync-facade.test.ts tests/features/animes/anime-mutation-connection.test.ts
  tests/features/sync/sync-facade-failure-precedence.test.ts
  tests/features/sync/use-sync-facade-connection-truth.test.ts
  tests/features/sync/notifee-foreground-service-adapter.test.ts` — 67/67 passed
- `npm test` (full suite) — **150 suites / 1023 tests passed** (baseline 150/1021; net +2: one
  `'failed'`-outcome test in the outbox suite, one `failedRemovals` test in the flush suite)
- `npx tsc --noEmit` — exit 0, no errors
- `npx eslint --max-warnings=0 --no-warn-ignored <all 11 touched files>` — clean, zero
  `dharness/*` findings (one line-length regression self-caught: an edit temporarily pushed
  `reconcile.helpers.test.ts` to 501 lines via a 3-line mock reformat; collapsed back to one line,
  498 total, before the final eslint pass)

Every file this phase touched (6 src, 5 test) stayed well under the 500-line rule (largest:
`reconcile.helpers.ts` at 483 lines, `sync-diagnostics-outbox.helpers.ts` at 128).

Not committed — orchestrator owns commit + final verification. Ready for Phase 4 (Operation-Log
Convergence Projection).

## Phase 2: Elapsed Time Correctness — DONE

- [x] 2.1 RED `tests/features/sync/__tests__/sync-telemetry.helpers.test.ts`
- [x] 2.2 GREEN `sync-telemetry.types.ts` + `sync-telemetry.helpers.ts` + `reconcile.helpers.ts`
- [x] 2.3 MUTATE — reinstated the deleted `now === undefined` branch; empirically confirmed
  uncatchable (see below); restored from index

### What changed

- `sync-telemetry.types.ts`: `BuildSyncCycleTelemetryInput.now` is now `number` (was `number?`),
  per design.md Decision D5. Doc comment rewritten to explain why optionality was the defect.
- `sync-telemetry.helpers.ts`: `deriveElapsedMs(startedAt, now: number)` — dropped the
  `now: number | undefined` widening and the `|| now === undefined` disjunct in its guard, so it
  now only short-circuits on `startedAt === null`. `buildPreviousCycleTelemetry`'s `now` parameter
  narrowed the same way.
- `reconcile.helpers.ts:347-357` (the sole production caller): added `now: Date.now()` to the
  `buildSyncCycleTelemetry(...)` call. This is the actual production gap the phase exists to
  close — `previous_cycle.elapsed_ms` was unreachable on the wire before this line existed.
- Fixture migration: `npx tsc --noEmit` was clean both before and after the type tightening,
  because every bare `buildSyncCycleTelemetry({...})` call site missing `now` was found and fixed
  by grep first (7 total across `tests/features/sync/__tests__/sync-telemetry.helpers.test.ts` and
  `tests/features/sync/__tests__/sync-telemetry-degraded.test.ts`), not discovered after the fact
  by a red `tsc` run.
- Test file convention: moved `tests/features/sync/sync-telemetry.helpers.test.ts` to
  `tests/features/sync/__tests__/sync-telemetry.helpers.test.ts` (same pre-existing `__tests__`
  violation Phases 1/1b fixed for the files they were required to touch — not a bulk pass).
  Replaced the one test that asserted the now-deleted branch's behavior (`elapsedMs` null when
  `now` is omitted despite a prior attempt existing — a scenario that can no longer be constructed
  under the tightened type) with two tests named directly after the spec's two GIVEN/WHEN/THEN
  scenarios: elapsed_ms non-null and non-negative given a prior attempt + `now`, and
  `previousCycle` (hence no `elapsed_ms`) staying null with no prior attempt.

### Honest disclosure: this phase's RED was a type contract, not a jest failure

Before touching source, I ran the migrated test file against the UNCHANGED implementation: all 52
tests in the three affected suites passed. The pure builder's null/non-null computation was never
actually wrong when `now` was supplied — the defect was entirely the missing argument at the one
production call site, which no jest fixture exercises (tasks.md scopes 2.1 to the pure-builder
test file only; the reconcile-level wiring test does not assert on `elapsed_ms`). So "RED" here is
the compile-time contract design.md D5 describes ("required turns a silent runtime null into a
compile error"), not a failing assertion.

### Mutation (2.3): confirmed uncatchable, exactly as design.md predicts

Staged the green `sync-telemetry.helpers.ts`, then reinstated `|| now === undefined` in
`deriveElapsedMs`'s guard. Checked all three mechanisms that could catch it:
- `npx tsc --noEmit`: clean. TypeScript does not flag `x === undefined` as an unintentional
  comparison (TS2367) even when `x`'s declared type excludes `undefined` — it special-cases
  comparisons against `null`/`undefined` to allow defensive runtime checks.
- `npx eslint --max-warnings=0 --no-warn-ignored src/features/sync/sync-telemetry.helpers.ts`:
  clean (no `no-unnecessary-condition`-style rule active here).
- Full `npm test`: 150/150 suites, 1021/1021 tests, still green — no real caller can ever supply
  `undefined` for a typed `number` parameter, so the branch has zero observable effect.
This matches design.md Decision D5 verbatim: "(mutation-tdd: unreachable code is removed, not
tested)." Restored via `git checkout -- src/features/sync/sync-telemetry.helpers.ts` (index
restore).

### Verification

- `npx jest tests/features/sync/__tests__/sync-telemetry.helpers.test.ts
  tests/features/sync/__tests__/sync-telemetry-degraded.test.ts
  tests/features/sync/sync-telemetry-scrubbing.test.ts
  tests/features/sync/reconcile-diagnostics-wiring.test.ts
  tests/features/sync/reconcile.helpers.test.ts` — 69/69 passed
- `npm test` (full suite) — 150 suites / 1021 tests passed (baseline 150/1020; net +1 from
  replacing 1 test with 2)
- `npx tsc --noEmit` — exit 0, no errors
- `npx eslint --max-warnings=0 --no-warn-ignored <touched files>` — clean, no `dharness/*` findings
  on any of the five touched files

Not committed — orchestrator owns commit + final verification.
