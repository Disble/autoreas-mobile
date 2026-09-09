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
