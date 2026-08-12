# Tasks: SQLite write-lock contention kills chapter mutations

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~692 authored (design Slice Forecast) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (A) → PR 2 (B) → PR 3 (C) → PR 4 (D1) → PR 5 (D2) → PR 6 (E1) → PR 7 (E2) → PR 8 (F) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR (base) | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| A | errcode/elapsedMs/stage telemetry | PR 1 (tracker) | `bunx jest tests/infrastructure/db/client/client.helpers.test.ts tests/features/animes/__tests__/anime-mutation-failure.helpers.test.ts` | `npm run sqlite:lab` h13 arm | Revert PR1: diagnostics removed, message/toast unchanged (additive) |
| B | Close success-gated, both leak sites | PR 2 (PR1) | `bunx jest tests/features/sync/__tests__/sqlite-sync-runtime.helpers.test.ts tests/features/sync/__tests__/notifee-foreground-service-adapter.helpers.test.ts` | `npm run sqlite:lab` h14 arm | Revert PR2: restores drop-before-close (additive, safe alone per rollback plan) |
| C | `busy_timeout` at every open path | PR 3 (PR2) | `bunx jest tests/infrastructure/db/startup.helpers.test.ts` | `npm run sqlite:lab` h2 arm | C alone is additive; revert with D/E |
| D1 | Path-keyed serializer | PR 4 (PR3) | `bunx jest tests/infrastructure/db/write-queue.test.ts` | N/A — Jest is the full proof of D1's scope | Revert restores per-connection queue; strictly safe alone |
| D2 | Route all eight write sites | PR 5 (PR4) | `bunx jest tests/features/sync/__tests__/*.test.ts` | `npm run sqlite:lab` h9/h10 + cycle-lock arm | Revert order E→D2→C per design Migration/Rollout |
| E1 | `BEGIN IMMEDIATE`, delete exclusive door | PR 6 (PR5) | `bunx jest tests/infrastructure/db/client/client.helpers.test.ts` | `npm run sqlite:lab` h3/h11 arms | Revert restores deferred `BEGIN` + exclusive door |
| E2 | Rename `withDeferredWrite`→`withLocalWrite` | PR 7 (PR6) | `bun run test` (full suite; mechanical) | N/A — no behavior change | Pure name revert |
| F | Write-door ESLint rule + docs | PR 8 (PR7) | `npx eslint src/features` | N/A — lint fixture is the check | Removes rule only; no source behavior change |

## Phase 0: Chain Setup (prerequisite — not its own PR)

- [ ] 0.1 Delete `tests/infrastructure/db/write-queue.test.ts:34-48` and `:50-60` (watchdog tests, H11-invalidated) permanently — never resurrected.
- [ ] 0.2 `git stash` the remaining working-tree diffs that belong to later slices: the cross-connection test in `write-queue.test.ts` (D1) and the two new tests in `sqlite-sync-runtime.helpers.test.ts` (B) — so PR 1 starts from a fully green suite. Re-apply each stash only when its own slice begins.
- [ ] 0.3 **DECISION NEEDED (flag to user, do not resolve here)**: commit `openspec/changes/sqlite-write-lock-contention/**` (untracked since inception)? Recommend bundling with PR 1 so the tracker branch carries SDD provenance from the first commit.
- [ ] 0.4 Commit `tests/sqlite-lab/`, `package.json`'s `sqlite:lab` script, and `eslint.config.mjs`'s `tests/sqlite-lab/**` ignore together with PR 1 — no RED tests of their own, and every slice's lab arm depends on them.

## Phase 1 (PR 1 — Slice A: errcode telemetry)

Branch `fix/sqlite-write-lock-contention-a-errcode-telemetry`, base tracker. Satisfies `write-failure-diagnostics` (both requirements).

- [ ] 1.1 RED `tests/infrastructure/db/client/client.helpers.test.ts` (new): control-byte string → primary errcode `5`; unparseable → `null`; `elapsedMs`/`stage` captured independent of errcode; `message` copied verbatim.
- [ ] 1.2 RED same file: `stage` is `begin`/`task`/`commit`/`rollback` per failure point.
- [ ] 1.3 RED `tests/features/animes/__tests__/anime-mutation-failure.helpers.test.ts`: toast copy byte-identical once diagnostics are read.
- [ ] 1.4 GREEN add `LocalWriteFailureDiagnostics` to `client.types.ts`.
- [ ] 1.5 GREEN implement the errcode parser/`toLocalWriteError` in `client.helpers.ts`. **Apply-time risk (b)**: degrade to `null` on iOS's `convertSqlLiteErrorToString` shape, never assume the Android control-byte format — unread at design time, verify before merge.
- [ ] 1.6 GREEN wire diagnostics into `anime-mutation-failure.helpers.ts` without changing toast text.
- [ ] 1.7 Runtime harness: add h13 arm to `tests/sqlite-lab/` measuring the `5`/`517` + elapsed split.
- [ ] 1.8 MUTATE: delete the errcode-parse guard, run only its test, confirm FAIL, `git checkout HEAD -- src/infrastructure/db/client/client.helpers.ts`.
- [ ] 1.9 Commit `fix(db): capture sqlite errcode diagnostics on write failure`.

## Phase 2 (PR 2 — Slice B: leak fixes)

Branch `-b-connection-leak-fixes`, base PR1. Satisfies `local-write-serialization` — Reachable, Closable Connections.

- [ ] 2.1 Re-apply stashed hunk (0.2): the two already-RED `sqlite-sync-runtime.helpers.test.ts` tests.
- [ ] 2.2 GREEN `sqlite-sync-runtime.helpers.ts:78-86` (`close()`): null `rawDb` only after `closeSyncRuntime` resolves, never before (Decision 6).
- [ ] 2.3 RED `notifee-foreground-service-adapter.helpers.test.ts`: `closeServiceRuntime` never throws even when `close()` rejects.
- [ ] 2.4 GREEN `notifee-foreground-service-adapter.helpers.ts:41-45`: swallow close failure, keep the handle.
- [ ] 2.5 MUTATE: delete the "null only after proven close" guard, run only its test, confirm FAIL, `git checkout HEAD -- src/features/sync/sqlite-sync-runtime.helpers.ts`.
- [ ] 2.6 Runtime harness: h14 arm — failed close, retry, lock released (extends H6).
- [ ] 2.7 Commit `fix(sync): keep a connection reachable after a failed close`.

## Phase 3 (PR 3 — Slice C: open-time policy)

Branch `-c-open-time-policy`, base PR2. Satisfies `local-write-serialization` — Open-Time Connection Policy.

- [ ] 3.1 RED `tests/infrastructure/db/startup.helpers.test.ts`: `openAppDatabaseSync` issues `PRAGMA busy_timeout` before returning the handle.
- [ ] 3.2 GREEN extract shared `applyConnectionPolicy` in `startup.helpers.ts`; call it from `openAppDatabaseSync` (`client.helpers.ts`) via `execSync` (Decision 5).
- [ ] 3.3 MUTATE: delete the pragma-at-open call, run only its test, confirm FAIL, `git checkout HEAD -- src/infrastructure/db/client/client.helpers.ts`.
- [ ] 3.4 Runtime harness: lab h2 arm — policy-opened connection waits ~5000ms, not 0.10ms.
- [ ] 3.5 Commit `fix(db): apply busy_timeout at connection open time`.

## Phase 4 (PR 4 — Slice D1: file-keyed serializer)

Branch `-d1-file-keyed-serializer`, base PR3. Satisfies `local-write-serialization` — File-Keyed Write Serializer (key only; routing is D2).

- [ ] 4.1 Re-apply stashed hunk (0.2): `write-queue.test.ts` test 3. Edit it to give both `buildRawDb()` mocks the **same** `databasePath`. **Apply-time risk (c)**: without this the test passes vacuously via the `DATABASE_NAME` fallback, not the real path key.
- [ ] 4.2 GREEN `client.constants.ts`: `WRITE_QUEUE_BY_DATABASE` → `Map<string, Promise<unknown>>`.
- [ ] 4.3 GREEN `client.helpers.ts` `withQueuedWrite`: key by `rawDb.databasePath ?? DATABASE_NAME` (Decision 1).
- [ ] 4.4 MUTATE: delete the path-key line, run only test 3, confirm FAIL, `git checkout HEAD -- src/infrastructure/db/client/client.helpers.ts`.
- [ ] 4.5 Commit `fix(db): key the write serializer by database file, not connection`.

## Phase 5 (PR 5 — Slice D2: route all eight write doors)

Branch `-d2-route-write-doors`, base PR4. Satisfies `local-write-serialization` — routing + "a write bypassing the serializer is a defect".

- [ ] 5.1 RED call-shape tests confirming each site now calls the door instead of raw `rawDb.runAsync`: `season-rating-queue.helpers.ts:202,217`; `operation-log-retention.helpers.ts:36,64`; `season-sync.helpers.ts:99,118`.
- [ ] 5.2 GREEN route those six sites; rename their raw callback params to `tx` (F's lint convention).
- [ ] 5.3 GREEN `sync-cycle-lock.helpers.ts`: route `claimSyncCycleLock:22` and `releaseSyncCycleLock:39` through the door; guard the release so its failure never replaces `run()`'s error.
- [ ] 5.4 RED a claim/release pair nests no doors; a throwing release does not replace `run()`'s error.
- [ ] 5.5 MUTATE: delete the release-error guard, run only its test, confirm FAIL, `git checkout HEAD -- src/features/sync/sync-cycle-lock.helpers.ts`.
- [ ] 5.6 Runtime harness: lab h9 re-run 0/1000; h10 with the bypasser closed stays 0/1000; contended `claimSyncCycleLock` waits and acquires instead of throwing.
- [ ] 5.7 Commit `fix(sync): route all eight write sites through the file-keyed door`.

## Phase 6 (PR 6 — Slice E1: BEGIN IMMEDIATE, delete withExclusiveWrite)

Branch `-e1-begin-immediate`, base PR5. Satisfies `local-write-serialization` — Upfront Write-Lock Acquisition.

- [ ] 6.1 **Apply-time risk (a)**: before deleting `withExclusiveWrite`, re-read every call site (`reconcile.helpers.ts:297,362,413`, `initial-sync.helpers.ts:66`) to confirm none depends on exclusive-transaction semantics beyond what the shared door now provides.
- [ ] 6.2 RED order `BEGIN IMMEDIATE` → task → `COMMIT`; task throws → exactly one `ROLLBACK`; `BEGIN` throws → no `ROLLBACK`; a failing `ROLLBACK` never masks the original error.
- [ ] 6.3 GREEN `client.helpers.ts`: `await rawDb.execAsync('BEGIN IMMEDIATE')` before the callback (design Statement Order).
- [ ] 6.4 GREEN delete `withExclusiveWrite`; drop it from `index.ts`.
- [ ] 6.5 GREEN `reconcile.helpers.ts`: collapse the `:362` `applyMode` selector to the single door; update its 3 call sites.
- [ ] 6.6 GREEN `initial-sync.helpers.ts:66`: retarget the type reference off the deleted export.
- [ ] 6.7 MUTATE: delete the "`BEGIN` outside the rollback guard" branch, run only its test, confirm FAIL, `git checkout HEAD -- src/infrastructure/db/client/client.helpers.ts`.
- [ ] 6.8 Runtime harness: lab h3 arm succeeds after waiting; h11 arm never reports "transaction within a transaction".
- [ ] 6.9 Commit `fix(db): acquire the write lock upfront and remove the exclusive-transaction door`.

## Phase 7 (PR 7 — Slice E2: rename to withLocalWrite)

Branch `-e2-rename-with-local-write`, base PR6. Mechanical — full suite is the regression check, no new test.

- [ ] 7.1 Rename `withDeferredWrite` → `withLocalWrite` across `client.helpers.ts`, `index.ts`, and every call site.
- [ ] 7.2 Commit `refactor(db): rename withDeferredWrite to withLocalWrite`.

## Phase 8 (PR 8 — Slice F: write-door ESLint rule + docs)

Branch `-f-write-door-lint-rule`, base PR7. Only landable now that D2 has routed all eight sites.

- [ ] 8.1 GREEN append an ESLint block after `createRecommendedConfig` in `eslint.config.mjs` restricting `runAsync|runSync|execAsync|execSync` and both `with*TransactionAsync` on `src/features/**`, exempting `callee.object.name === 'tx'` (Decision 8).
- [ ] 8.2 Verify: a fixture calling `rawDb.runAsync` under `src/features/**` fails lint, **and** `npx eslint src/features` passes clean.
- [ ] 8.3 Update `ARCHITECTURE.md` and `CLAUDE.md` constraint 8: correct the stale Bridge Boundary claim — `no-restricted-syntax` no longer exists; dlinter's `infrastructure` edge cannot express the write door.
- [ ] 8.4 Commit `docs(db): add the write-door lint rule and correct the stale boundary doc`.
