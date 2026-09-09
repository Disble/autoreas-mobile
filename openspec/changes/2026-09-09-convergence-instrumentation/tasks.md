# Tasks: Convergence Instrumentation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950-1050 across 5 slices |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Slice 1 → 2 → 3 → 4 → 5, one local commit each |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

No PR/push workflow here: "chained PRs" means chained local commits to `main`.

### Suggested Work Units

| Unit | Goal | Commit | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | 7 identity fields + vocabulary narrowing | 1 | `bunx jest tests/features/sync/__tests__/sync-runtime-status.helpers.test.ts` | N/A — pure builder | revert `sync-runtime-status.{helpers,types}.ts` |
| 2 | `now` required, `elapsed_ms` reachable | 2 | `bunx jest tests/features/sync/__tests__/sync-telemetry.helpers.test.ts` | N/A — pure builder | revert `sync-telemetry.*.ts`, `now` call |
| 3 | outbox outcome + discard/failedRemovals | 3 | `bunx jest tests/infrastructure/db/sync-diagnostics-outbox tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts` | N/A — fake store/client harness | revert outbox, flush, `reconcile.types.ts` |
| 4 | `operation_log` convergence projection | 4 | `bunx jest tests/features/sync/__tests__/operation-log-convergence.helpers.test.ts` | in-memory SQLite | delete new files; revert retention export |
| 5 | fold into one write + Settings tiles | 5 | `bunx jest tests/features/sync/__tests__/headless-sync-cycle.helpers.test.ts tests/features/settings/__tests__/settings-screen.helpers.test.ts` | `npm run validate` | revert schema/migration + wiring + settings |

## Phase 1: Cycle Identity & Stage Persistence

- [x] 1.1 RED `sync-runtime-status.helpers.test.ts`: start/success/failure patches carry `cycleId`/stage/stageAt; success and start clear the error triple; `consecutiveUnclosedCycles` increments/resets; add the vocabulary golden test.
- [x] 1.2 GREEN `sync-runtime-status.helpers.ts`: extend the three builders with the seven fields; `sync-runtime-status.types.ts`: narrow `lastErrorName`/`lastErrorStage` in `SyncRuntimeStatusPatch`; fix `dharness/*` JSDoc findings.
- [x] 1.3 MUTATE `sync-runtime-status.helpers.ts`: delete the error-triple clear; confirm test fails; restore via checkout.

## Phase 1b: Wire Real Cycle Values Into The Recorders

Added after Phase 1 landed. Phase 1 made the seven fields representable but nothing
passes real values, so production still writes null and `previous_cycle.*` stays
unreachable on the wire -- the outcome this whole change exists to produce. This
phase closes that gap and must land before Phase 5.

- [x] 1b.1 RED `tests/features/sync/__tests__/headless-sync-cycle.helpers.test.ts`: a cycle records its minted `cycleId` and its current stage on start; a failed cycle records the classified error name, stage and native errcode byte; `consecutiveUnclosedCycles` advances when the previous cycle never closed.
- [x] 1b.2 GREEN `src/features/sync/headless-sync-cycle.helpers.ts`: thread the cycle's own `createSyncCycleId()` value, its stage checkpoints and the classified failure detail into `recordSyncAttemptStarted` / `recordSyncAttemptSucceeded` / `recordSyncAttemptFailed`. Reuse the existing classifiers in `sync-telemetry.helpers.ts`; do not invent a second taxonomy. Pay the `dharness/*` JSDoc findings on every file touched.
- [x] 1b.3 MUTATE `src/features/sync/headless-sync-cycle.helpers.ts`: drop the `cycleId` argument at the start call site; confirm the Phase 1b RED test fails; restore via `git checkout --` from the index.

## Phase 2: Elapsed Time Correctness

- [ ] 2.1 RED `sync-telemetry.helpers.test.ts`: `elapsed_ms` non-null given a prior attempt timestamp and `now`; stays null with no prior attempt.
- [ ] 2.2 GREEN `sync-telemetry.types.ts`: `now: number` required; `reconcile.helpers.ts`: pass `now: Date.now()` (~line 347); delete `deriveElapsedMs`'s unreachable branch; migrate every fixture `tsc` flags; fix `dharness/*` findings.
- [ ] 2.3 MUTATE `sync-telemetry.helpers.ts`: reinstate the deleted branch; confirm test fails; restore via checkout.

## Phase 3: Diagnostics Delivery Outcome

- [ ] 3.1 RED `sync-diagnostics-outbox.helpers.test.ts`: `remove()` returns `'removed'` on success, `'failed'` on a thrown `runSync`, never throws.
- [ ] 3.2 GREEN outbox types/helpers: add `SyncDiagnosticsOutboxWriteOutcome`; `remove()` returns it; update `buildFakeStore` in `sync-diagnostics-flush.helpers.test.ts` to `mockReturnValue('removed')`.
- [ ] 3.3 RED `sync-diagnostics-flush.helpers.test.ts`: `delivered` only on `'removed'`; `failedRemovals` on 2xx+`'failed'`; `discarded` on 400/413/422.
- [ ] 3.4 GREEN `sync-diagnostics-flush.{types,helpers}.ts`; widen `SyncPendingOperationsResult` (`reconcile.types.ts`), return the flush result upward (`reconcile.helpers.ts`); update reconcile test stubs; fix `dharness/*` findings.
- [ ] 3.5 MUTATE `sync-diagnostics-flush.helpers.ts`: delete the `isEnvelopeRejection` check; confirm test fails; restore via checkout.

## Phase 4: Operation-Log Convergence Projection

- [ ] 4.1 `operation-log-retention.helpers.ts`: export `countRowsForStatus`; create `operation-log-convergence.types.ts` (`OperationLogConvergence`).
- [ ] 4.2 RED `operation-log-convergence.helpers.test.ts` (in-memory SQLite): `dead_letter`/`conflict_exhausted`/`processing` counts, `oldestPendingAgeMs` null on empty, `hasMore` at/over the batch limit.
- [ ] 4.3 GREEN create `operation-log-convergence.helpers.ts`: `readOperationLogConvergence(rawDb)`; fix `dharness/*` findings.
- [ ] 4.4 MUTATE: flip the `hasMore` comparator; confirm test fails; restore via checkout.

## Phase 5: Single-Write Integration & Settings Surface

- [ ] 5.1 `schema/database.schema.ts`: 8 additive nullable columns; generate migration `0013_*.sql` (hand-trim if stale, per `0010`); update `migrations.js` + `meta/_journal.json`; `sync-runtime-status.types.ts`/`.constants.ts`: 8 counter fields with defaults.
- [ ] 5.2 RED+GREEN `sync-runtime-status.helpers.test.ts`/`.ts`: widen `recordBacklogReadCount` into one cycle-bookkeeping patch carrying flush counters + projection.
- [ ] 5.3 RED+GREEN `headless-sync-cycle.helpers.test.ts`/`.ts`: one cycle folds the flush result and `readOperationLogConvergence` into that single write.
- [ ] 5.4 `use-background-sync-status.ts`: map the 8 columns with `?? 0`/`?? null`; RED+GREEN `settings-screen.helpers.test.ts`/`.{helpers,types}.ts`: tiles beside `backlogReadCount`; fix `dharness/*` findings.
- [ ] 5.5 MUTATE `settings-screen.helpers.ts`: delete the `hasMore`-driven tone branch; confirm test fails; restore via checkout.
- [ ] 5.6 Run `npm run validate` and `npx react-doctor@latest . --verbose --diff` until 100/100.
