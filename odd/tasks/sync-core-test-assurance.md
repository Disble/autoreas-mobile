# sync-core-test-assurance

Feature: put a quality gate on the sync functionality, the most important feature of the mobile app. The
gate applies the maintainer's **100/80/0** tiers per file, not a global number:

- **CORE: 100 %.** Critical sync logic: what is sent to the bridge, what is written locally, cursor
  advance, `operation_log` transitions, conflict resolution, wire parsing and validation, response
  apply, lease correctness, and recovery of stuck state.
- **IMPORTANT: 80 %.** User-visible sync features and orchestration with real branching.
- **INFRA: 0 %.** Self-validating code: types, constants with no logic, thin native seams, barrels,
  task registration.

Status: in progress. Branch `test/sync-core-assurance`, cut from `dev` at `51497b3`.

Delivery strategy: `single-pr`, for the same reason as `native-foreground-sync-service.md`: there is
no PR process, and delivery is a local merge. Each work-unit commit stands alone.

TDD: enabled. Sources: user `CLAUDE.md` (Strict TDD) and project `CLAUDE.md` (RED → GREEN → MUTATE
→ REFACTOR). Runner: `bun run test`, focused runs with `bunx jest <path>`, and Kotlin with
`bun run test:kotlin`. Gate: `npx lefthook run pre-commit`.

Most new tests in this feature characterise **existing** behaviour, so they go green on first run. For
those, the RED evidence is the MUTATE step: delete or invert the guarded behaviour, watch the test
fail, then restore from the index. A test that survives the mutation of the line it claims to cover
does not count toward the tier.

RDD: off (global).

## Why

On 2026-09-24 the maintainer asked whether any integration test guarantees a quality metric for sync.
Measured answer:

- Integration tests exist on both engines. Kotlin: `SyncEngineCycleTest` runs Robolectric with real
  SQLite and a real HTTP server on `127.0.0.1`. JS: 19 behaviour tests in `tests/behaviour/sync/`
  run real drizzle over `node:sqlite`.
- **No metric is enforced.** Jest has no `coverageThreshold`, and Kotlin has no coverage tool.
- **Mutation testing covers 3 thin seam files**, and none of the sync core.
- **The JS and Kotlin engines implement the same reconcile protocol independently**, each with its
  own fixtures. A change on one side does not fail the other side's tests.
- JS sync coverage is already 95 % lines / 89 % branches overall. A global threshold would guarantee
  close to nothing, so the maintainer chose per-file tiers.

E2E (device or real bridge) is out of scope: there is no infrastructure for it yet.

## Tier classification

Produced by a read-only mapping pass on 2026-09-24. Borderline calls were decided by the parent:

- `headless-sync-cycle.helpers.ts` is **CORE**: its purpose is recovery of stuck state.
- `sync-cycle-lock.constants.ts` is **CORE**: it holds the fencing SQL itself. The same goes for
  `SyncEngineDatabases.kt`.
- `sync-telemetry.helpers.ts` is **IMPORTANT**: it never decides what sync data is written.
- `SyncEngineBridgePresence.kt` is **IMPORTANT**: a defect costs one tick, not data.
- `reconcile.constants.ts` / `reconcile-conflict.constants.ts` stay **INFRA**. Their vocabulary strings
  are pinned by the CORE tests that consume them.

**CORE, JS (`src/features/sync/`):** `reconcile.helpers.ts`, `reconcile-request.helpers.ts`,
`reconcile.schema.ts`, `reconcile-schema.helpers.ts`, `reconcile-conflict.helpers.ts`,
`reconcile-confirmation.helpers.ts`, `reconcile-base-token.helpers.ts`, `reconcile.errors.ts`,
`applied-operation-token.helpers.ts`, `operation-log-convergence.helpers.ts`,
`operation-log-retention.helpers.ts`, `sync-cycle-lock.helpers.ts`, `sync-cycle-lock.constants.ts`,
`pending-remote-changes.helpers.ts`, `remote-change-drain.helpers.ts`, `last-changelog.helpers.ts`,
`full-resync.helpers.ts`, `initial-sync.helpers.ts`, `initial-sync.schema.ts`,
`headless-sync-cycle.helpers.ts`, `season-rating-queue.helpers.ts`, `merge/*.helpers.ts` (4 files).

**CORE, JS outside sync (write and wire path):**
- `src/infrastructure/api/bridge-client/{bridge-client.helpers,bridge-url.helpers,bridge-client.errors}.ts`
- `src/infrastructure/validation/anime-schema/{anime.schema,anime-wire.helpers}.ts`
- `src/features/animes/anime-mutation.helpers.ts`
- `src/infrastructure/db/anime-repository/{anime-repository,anime-repository.helpers}.ts`

**CORE, Kotlin (`modules/sync-engine`):** `ReconcileRequestBody`, `ReconcileResponseParser`
(+ `WireAnimeMapper`), `ReconcileConfirmation`, `SyncEngineResponseApplier`, `SyncCycleLease`,
`SyncEngineDatabases`, `SyncEngineRecovery`, `OperationLogPruner`, `SyncEngineCycle`,
`SyncEngineHttp`, `SyncEngineRunner`.

**IMPORTANT:** the remaining `src/features/sync/**` helpers and hooks with branching, plus
`sync-telemetry.helpers.ts`. On the Kotlin side: `SyncEngineJournal`, `SyncEngineBridgePresence`,
`SyncEngineRuntimeStatus`, `SyncForegroundService`, `SyncForegroundServiceBridge`, and the ticker module
(`ForegroundSyncTickerModule`, `TickAlarmReceiver`, `TickAlarmScheduler`).

**INFRA:** `*.types.ts`, `*.constants.ts` without logic, `index.ts` barrels, the three thin native
seams, `background-sync.task.ts`, and `SyncEngineModule.kt`.

Known gaps at the start:
- `OperationLogPruner.kt` has **no test at all**.
- `ReconcileConfirmation.kt`, `SyncEngineDatabases.kt` and `SyncEngineHttp.kt` are tested only
  indirectly.
- `use-reconcile.ts` is absent from the coverage summary. This must be explained before any threshold
  touches it.

## Decisions

- **The tier list is the source of truth, and it lives in config, not in prose.** The Jest
  `coverageThreshold` keys and the Kotlin coverage rules name files explicitly. A file that is not
  classified gets no gate. The feature document is updated whenever the list changes.
- **100 % means all four metrics** (lines, branches, functions, statements) for CORE.
- **Unreachable code is deleted, not ignored.** An `istanbul ignore` or a Kover/JaCoCo exclusion
  inside a CORE file needs a written reason at the site. The default answer to an uncoverable branch
  is to prove it unreachable and remove it.
- **Coverage is necessary, not sufficient.** Mutation testing on the CORE JS files (T4) checks that
  the 100 % is asserted, not just executed.

## Tasks

- [x] **T1 — JS tier gate.** Add per-file `coverageThreshold` to Jest (CORE 100, IMPORTANT 80). Bring
  every CORE JS file to 100 %. Decide where the gate runs (pre-commit vs a dedicated script) from its
  measured cost.
- [ ] **T2 — JS↔Kotlin wire contract.** Shared golden fixtures (reconcile request and response, wire
  anime) that the Jest tests and the Kotlin tests both read. Divergence fails a test on both sides.
- [ ] **T3 — Kotlin tier gate.** Add Kover or JaCoCo to `sync-engine` (and the ticker for IMPORTANT),
  with per-class rules. Write the missing `OperationLogPruner` tests and bring the CORE classes to
  100 %.
- [ ] **T4 — Mutation on CORE JS.** Extend the staged mutation surface to the CORE JS files, measure
  the score, and set the break threshold.

Checks per task: focused tests, `bun run test`, `bun run test:kotlin` when Kotlin changes, and
`npx lefthook run pre-commit` before each commit.

## Progress

### T1 — JS tier gate (done)

Route: delegated writer (writer trigger: 31 files). The writer was cut off by a usage limit and
resumed with its context. The parent reviewed the result and made one correction. Authored lines:
~1440, almost all of them tests. That is over the ~400 heuristic because 17 CORE files each needed
their own branch tests; nothing was split artificially.

- **Config.** `jest.coverage-tiers.js` holds the CORE (33 files, 100 % on all four metrics) and
  IMPORTANT (32 files, 80 %) lists. `jest.config.js` builds `coverageThreshold` from them, with no
  `global` key. **Deviation from the classification:** the three thin native seams
  (`native-battery-optimization`, `native-foreground-service-presence`,
  `native-foreground-sync-ticker` helpers) are gated as IMPORTANT, not INFRA. They are already at
  100 % and are the existing Stryker surface, so gating them costs nothing.
- **Where the gate runs.** The pre-commit `test` job runs `bunx jest --maxWorkers=4 --coverage`, and
  the release CI `Test` step runs `bun run test:coverage`. Measured cost: `test` 12.1–13.6 s,
  `test:coverage` 13.4–17.4 s. Focused runs (`bunx jest <path>`) stay without coverage on purpose:
  per-file thresholds would fail on every file the focused run does not load. **Risk:** that
  lefthook job is marked `dlinter:owned`, so `dlinter init` may rewrite it. The comment at the site
  says to restore the flag.
- **Coverage.** 17 CORE files were raised to 100/100/100/100. The largest jump was `anime.schema.ts`
  (branches 40.9 → 100) and `operation-log-retention.helpers.ts` (63.6 → 100). The 16 others were
  already at 100. Seven IMPORTANT files were raised above 80.
- **MUTATE.** The writer reports one observed failing mutation per new CORE assertion. The parent
  re-ran two independently:
  - `anime.schema.ts:64`, wire empty-string → `[]` coercion removed: 1 of 18 tests failed.
  - The season-rating drain branch inverted: 5 of 20 failed.

  Both were restored from the index.
- **Production changes, both behaviour-preserving:**
  - `season-rating-queue.helpers.ts`. The writer had replaced `else if (nextQueueStatus)` with an
    `as SeasonRatingQueueStatus` cast. **The parent rejected the cast**, because it hides the
    invariant from the type checker instead of proving it. The drain now branches on
    `nextQueueStatus === null` itself, and TypeScript narrows the kept branch. This is equivalent,
    because every return of `resolveSeasonRatingDelivery` pairs `null` with
    `shouldKeepEntry: false`. The writer also added JSDoc to 7 existing functions (lint rule on
    touched files).
  - `field-merge.helpers.ts`: one `istanbul ignore next`, with its reason at the site. It guards
    drift between the two mirrored 19-field lists. Deleting it would turn that drift into a crash.
- **Findings, not fixed (scope):**
  1. `use-reconcile.ts` is **dead code**: `useReconcile` has no consumer in `src`, and its test file
     actually tests `syncPendingOperations`. Jest emits no coverage entry for it, and a threshold on
     a path with no entry fails the whole run. So it is deliberately in neither tier. Deleting it is
     a separate decision.
  2. `season-rating-queue.helpers.ts`: the parsed `lastFailureKind` is write-only (reset on retry,
     overwritten on outcome). Its `typeof value !== 'string'` guard is covered, but a mutation of it
     survives. This is disclosed as the one weak spot in the CORE JS set.

Checks: `bun run test:coverage` exit 0 (184 suites / 1498 tests, all thresholds met);
`bun run typecheck` exit 0; `npx lefthook run pre-commit` green before the commit (see commit).

Next: T2 (JS↔Kotlin contract).
