# Tasks: Background Sync Bounded Awaits

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~694 (design.md File Changes: ~269 src + ~425 tests) |
| 400-line budget risk | Medium (694 exceeds the default 400-guard; fits the session's granted 800 with only ~106-line margin — dharness JSDoc debt on 14 touched files could erode it) |
| Chained PRs recommended | No — this repo has no PR chain; delivery is a local merge to `main` (no `adb`, no push) |
| Suggested split | Single change, two internally-ordered slices (see below) |
| Delivery strategy | auto-chain |
| Chain strategy | pending — not applicable under the local-merge delivery model; ordering below is task/commit order, not stacked branches |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| A | `withDeadline` primitive + bounded bridge request (Phases 1–3) | Slice A (~305 lines, local merge) | `bunx jest tests/infrastructure/async tests/infrastructure/api/bridge-client.helpers.test.ts` | N/A — fake timers only, no device | `git revert`; async/ folder + bridge-client edits are additive |
| B | Write door, cycle deadline, host signal, interval, lint selector (Phases 4–8) | Slice B (~389 lines, depends on A for `withDeadline`) | `bunx jest tests/infrastructure/db/client tests/features/sync` | N/A — fake timers only, no device | `git revert`; each guard is additive/single-token |

Constraint: every acceptance below is unit-testable with `jest.useFakeTimers()` + `advanceTimersByTimeAsync`. No device, no `adb`.

## Phase 1: Shared `withDeadline` Primitive (infra/async) — R8

- [ ] 1.1 RED `tests/infrastructure/async/__tests__/deadline.helpers.test.ts`: resolves before deadline; rejects `DeadlineExceededError` after; `jest.getTimerCount()===0` both paths; a `process.on('unhandledRejection')` probe stays silent on a late-rejecting operation.
- [ ] 1.2 GREEN `src/infrastructure/async/deadline.helpers.ts`: `withDeadline<T>`, `DeadlineExceededError`; `clearTimeout` in `finally` on every path.
- [ ] 1.3 `src/infrastructure/async/index.ts`: pure re-export barrel.
- [ ] 1.4 MUTATE: delete `clearTimeout` in `finally` → timer-count assertions must go RED; restore.
- [ ] 1.5 MUTATE: delete the losing-branch `.catch(() => undefined)` → unhandledRejection probe must go RED; restore.

## Phase 2: Timing Constant Total Order — R8 acceptance

- [ ] 2.1 Add `BRIDGE_REQUEST_TIMEOUT_MS=10_000`, `LOCAL_WRITE_DEADLINE_MS=20_000`, `BACKGROUND_SYNC_CYCLE_DEADLINE_MS=45_000`, `BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS=90_000`, `BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS=600_000` with rationale JSDoc in their owning constants files. Do not change existing `SQLITE_BUSY_TIMEOUT_MS` (`startup.constants.ts:5`) or `DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS` (`sync-cycle-lock.constants.ts:5`).
- [ ] 2.2 RED→GREEN `tests/features/sync/__tests__/background-sync-bounded-awaits.test.ts`: one pure-comparison test asserting the full 7-constant `<` chain, importing the real constants.

## Phase 3: Bounded Bridge Request — Decisions 2–3

- [ ] 3.1 RED `tests/infrastructure/api/bridge-client.helpers.test.ts`: a never-settling `fetchFn` rejects `BridgeTimeoutError` at `BRIDGE_REQUEST_TIMEOUT_MS`; `init.signal.aborted===true`; `spec.timeoutMs` overrides; timer count 0 after success, HTTP 500, and a network throw; `BridgeTimeoutError instanceof BridgeUnreachableError === true`.
- [ ] 3.2 GREEN `bridge-client.types.ts`: optional `timeoutMs` on `BridgeRequestSpec`.
- [ ] 3.3 GREEN `bridge-client.helpers.ts`: add `BridgeTimeoutError extends BridgeUnreachableError`; `request()` builds an owned `AbortController` + `setTimeout`, sets `init.signal`, `clearTimeout` on every path.
- [ ] 3.4 Export `BridgeTimeoutError` from `bridge-client/index.ts` and `api/index.ts`.
- [ ] 3.5 MUTATE: delete `init.signal = controller.signal` → abort test must go RED; restore.

## Phase 4: Write Door Deadline — Decision 6 (`local-write-serialization` spec)

- [ ] 4.1 RED `tests/infrastructure/db/client/client.helpers.test.ts`: a never-settling `runWrite` rejects the caller with `LocalWriteError`/`stage:'deadline'` at `LOCAL_WRITE_DEADLINE_MS`, `elapsedMs` includes queue wait. Door-closed test: after the first caller's deadline fires, a second `withLocalWrite` on the same `databasePath` has NOT started — `BEGIN IMMEDIATE` issued once — until the first settles.
- [ ] 4.2 GREEN `client.constants.ts`: add `LOCAL_WRITE_DEADLINE_MS=20_000`.
- [ ] 4.3 GREEN `client.types.ts`: `LocalWriteFailureStage` += `'deadline'` (open question: confirm no exhaustive `switch` over this union exists first).
- [ ] 4.4 GREEN `client.helpers.ts` `withQueuedWrite`: queue keeps chaining on the real `nextWrite`; only the caller's returned promise is wrapped in `withDeadline`; a `DeadlineExceededError` rethrows via `toLocalWriteError(..., 'deadline')`.
- [ ] 4.5 MUTATE (critical — the exact regression this change exists to prevent): change `WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite…)` to set the raced promise instead → door-closed test must go RED; restore.

## Phase 5: Cycle Deadline — Decision 4

- [ ] 5.1 RED (in `background-sync-bounded-awaits.test.ts`): a `run` that never settles → `runBackgroundSyncCycle` rejects `SyncCycleDeadlineError` at `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` AND `releaseSyncCycleLock` still ran.
- [ ] 5.2 GREEN `src/features/sync/background-sync.errors.ts` (new): `SyncCycleDeadlineError`.
- [ ] 5.3 GREEN `background-sync.helpers.ts`: wrap the `run` callback passed to `withExclusiveSyncCycle` in `withDeadline` — never wrap the outer call, so the lock's `finally` still releases.
- [ ] 5.4 MUTATE: remove the `withDeadline` wrapper around `run` → cycle-hang test must go RED; restore.

## Phase 6: Host Completion Signal — Decision 5

- [ ] 6.1 RED: a never-settling `runCycle` → `resolveBackgroundTaskOutcome` resolves `'failed'` at `BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS`; a throwing `runCycle` resolves `'failed'`; a normal one resolves `'success'`.
- [ ] 6.2 GREEN `background-sync.helpers.ts`: `resolveBackgroundTaskOutcome({ runCycle, timeoutMs })` wraps the whole `runBackgroundSyncCycle()` call (incl. `runtime.open`/`finally close`); no Expo enum in this file.
- [ ] 6.3 RED→GREEN `tests/features/sync/background-sync.task.test.ts`: the `defineTask` callback always settles with a `BackgroundTaskResult` when the cycle hangs.
- [ ] 6.4 GREEN `background-sync.task.ts`: map `'success'|'failed'` onto `BackgroundTask.BackgroundTaskResult.Success|Failed` via `resolveBackgroundTaskOutcome`.
- [ ] 6.5 MUTATE: remove the deadline branch in `resolveBackgroundTaskOutcome` → host-signal test must go RED; restore.

## Phase 7: Scheduler Interval Unit — D8/T4

- [ ] 7.1 RED: assert `BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval === 15` (not `15 * 60`).
- [ ] 7.2 GREEN `background-sync.constants.ts`: `minimumInterval: 15`.

## Phase 8: Write-Door Lint Boundary — Decision 7 (`local-write-serialization` spec)

- [ ] 8.1 RED `tests/infrastructure/__tests__/write-door-lint-boundary.test.ts`: `new Linter({ configType: 'flat' })` — the new selector reports exactly 1 error on a snippet calling `bridgeClient.reconcile`/`fetch`/`new WebSocket` inside a `withLocalWrite` callback, 0 on a compliant snippet. Fallback if `Linter` won't load under `jest-expo`: import `eslint.config.mjs` and assert the rule entry + selector string are present.
- [ ] 8.2 GREEN `eslint.config.mjs`: add a `no-restricted-syntax` block sibling to the Write Door selector (`:48-56`), `files: ['src/**/*.ts','src/**/*.tsx']`, selector forbidding `bridgeClient.*`/`fetch`/`new WebSocket` lexically inside a `withLocalWrite` callback.
- [ ] 8.3 MUTATE: remove the new selector entry → lint-boundary test must go RED; restore.

## Phase 9: Regression Gate

- [ ] 9.1 `bun run test` — floor 109 suites/654 tests plus all new suites, all green.
- [ ] 9.2 `bun run lint` (`--max-warnings=0`) clean on every staged file — JSDoc written as part of each edit (constraint 12), not a cleanup pass.
- [ ] 9.3 `bun run typecheck` clean.
- [ ] 9.4 Confirm the two apply-time open questions from design.md: no exhaustive `switch` over `LocalWriteFailureStage` broke; lint-boundary fallback used only if `Linter` proves unloadable.

Do not commit — leave changes staged/unstaged in the working tree per orchestrator instruction.
