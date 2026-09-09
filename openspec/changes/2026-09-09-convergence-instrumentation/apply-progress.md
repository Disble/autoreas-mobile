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
