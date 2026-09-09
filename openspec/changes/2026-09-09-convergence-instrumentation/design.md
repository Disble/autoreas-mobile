# Design: Convergence Instrumentation

## Technical Approach

Five vertical TDD slices inside `src/features/sync` — no new feature folder, no bridge edit. Slices 1–2 make already-reachable wire fields carry values. Slices 3–5 make mobile-only facts observable through the proven `sync_runtime_status` → `use-background-sync-status.ts` → `settings-screen.helpers.ts` path. Every new counter rides a runtime-status write that already happens, so the shared write door gains **zero** transactions.

## Architecture Decisions

### D1 — Convergence projection: read-only sibling module

| Option | Trade-off | Verdict |
|---|---|---|
| New `sync-convergence` feature via `generate:feature` | Full folder ceremony for one read-only query set; splits `operation_log` knowledge across two features | Rejected |
| Add the projection inside `operation-log-retention.helpers.ts` | File is about *deleting*; measuring what it deletes in the same module invites `dharness/role-file-shape` and pushes the 500-line rule | Rejected |
| **`src/features/sync/operation-log-convergence.helpers.ts` + `.types.ts`; export `countRowsForStatus`** | One extra module; retention exports a primitive named for its role | **Chosen** |

`countRowsForStatus` (`operation-log-retention.helpers.ts:27`) is **exported, not copied or wrapped**: its own JSDoc already calls it "the shared building block behind every count/prune query", and `countOperationLogBacklogRows:178` is the in-repo precedent for composing it from an exported sibling. A duplicated `COUNT` is how two counts of the same table disagree. It uses `getFirstAsync` — a read — so the projection **never touches `withLocalWrite`**.

### D2 — `remove()` returns an outcome; the swallow survives

Complete caller/assertion inventory taken before choosing the shape:

| Site | Today | Migration |
|---|---|---|
| `sync-diagnostics-flush.helpers.ts:91` (2xx) | `remove(); delivered += 1` | `delivered` only on `'removed'`; else `failedRemovals += 1` |
| `sync-diagnostics-flush.helpers.ts:97` (400/413/422) | `remove(); continue` | `discarded += 1` (see D3) |
| Production consumers of `SyncDiagnosticsFlushResult` | **None** — `reconcile.helpers.ts:381` awaits and discards | Result now returned up via `SyncPendingOperationsResult` |
| `sync-diagnostics-flush.helpers.test.ts:34` `buildFakeStore` | `remove: jest.fn()` → `undefined` | `mockReturnValue('removed')` — **the only breaking edit** |
| Same file, `delivered` asserted at `:103 :123 :146 :168 :188 :209 :230` | inflated count | All hold unchanged once the fake returns `'removed'` |
| `sync-diagnostics-outbox.helpers.test.ts:58,72,164` | return unasserted; `getFailedWriteCount()===1` | Unchanged; add RED cases asserting `'removed'` / `'failed'` |
| `reconcile.helpers.test.ts:18`, `reconcile-diagnostics-wiring.test.ts:19` | stub `{attempted:0,delivered:0}` | Extend stub with the new counters |

**Chosen**: `remove: (cycleId: string) => SyncDiagnosticsOutboxWriteOutcome` where the type is `'removed' | 'failed'`. Rejected: `boolean` (a bare `true` at the call site does not say what it asserts, and this codebase consistently prefers closed string unions — `SyncCycleOutcome`, `OperationLogBacklogStatus`); rejected: diffing `getFailedWriteCount()` around the call (that counter is shared with `enqueue`/`deferUntil`, so a delta can be attributed to the wrong write — a stateful side channel, not a return value).

The "instrumentation must never fail a sync cycle" contract lives in the `try/catch` and the `failedWriteCount += 1`, **not** in the `void` return. Both stay verbatim; only the return type widens, so the contract is untouched by construction. `'removed'` means *the DELETE executed without throwing* — deliberately **not** gated on `changes > 0`, because a row that was already absent is still absent, which is the invariant the caller needs.

### D3 — A discard is not a deferral

`SyncDiagnosticsFlushResult` gains `discarded` and `failedRemovals`:

| Per-candidate outcome | Counter |
|---|---|
| 2xx, remove confirmed | `delivered` |
| 2xx, remove failed → row re-sends next cycle (the 600,055 ms replay) | `failedRemovals` |
| 400/413/422 → report destroyed client-side | `discarded` |
| 404/408/429/5xx/throw → row stays queued, batch stops | none; implied by `attempted > delivered + discarded + failedRemovals` |

`discarded > 0` is the **only** alarm a vocabulary drift can ring (D4). Alternative rejected: a boolean `stoppedEarly` flag — it reports that the batch halted but not *how many* reports were destroyed, which is the number that matters.

### D4 — Vocabulary safety: narrow on write, normalize on read, observe the drift

The TS mirrors already exist and match `vocabulary.go` member-for-member: `SYNC_CYCLE_STAGES` (11 ≡ `syncStages`), `SYNC_CYCLE_ERROR_NAMES` (6 ≡ `syncErrorNames`), `SYNC_CYCLE_ERROR_STAGES` (6 ≡ `syncErrorStages`). The gap is the **write** side: `SyncRuntimeStatusPatch.lastErrorName`/`lastErrorStage` are `string | null`, so a builder can persist anything.

**Chosen**: narrow those two patch fields to `SyncCycleErrorName | null` / `SyncCycleErrorStage | null` (`lastCycleStage` is already `SyncCycleStage | null`). An out-of-vocabulary symbol then fails `npm run typecheck` at the write site — unrepresentable, not merely unlikely. `SyncRuntimeStatusSnapshot` keeps `string | null` and the read-side normalizers stay: the columns are free-form TEXT and legacy rows predate the union.

**This is a hand-mirrored copy with no codegen** (explicitly out of scope). Drift is caught in two layers, neither of which is static across repos: (1) a golden membership test pinning each array's exact members, so a TS-side edit is loud; (2) at runtime, a Go-side edit that our values no longer satisfy produces a `400`, which D3 now counts as `discarded` and surfaces in Settings. Rejected: a test that reads `../autoreas-bridge/.../vocabulary.go` — the mobile repo must typecheck and test without the bridge checkout present (the EAS container mounts this repo only).

### D5 — `now` becomes required

**Chosen**: `BuildSyncCycleTelemetryInput.now: number` (was `now?: number`). Optionality is precisely the mechanism that kept `elapsed_ms` null for the feature's whole life; required turns a silent runtime null into a compile error, and `tsc` enumerates every fixture to migrate. Consequence: `deriveElapsedMs`'s `now === undefined` branch becomes unreachable and is **deleted** (mutation-tdd: unreachable code is removed, not tested). `reconcile.helpers.ts:347-357` passes `now: Date.now()` at the build site; no injection seam is added there because the pure builder is already the seam that owns elapsed logic, and the call site is covered by the existing `reconcile-diagnostics-wiring.test.ts` pattern. Rejected: keeping it optional and just passing it — that leaves the trap armed for the next caller.

### D6 — New counters land in `sync_runtime_status` and the existing Settings screen

Additive nullable columns, read with `?? 0` / `?? null` in `use-background-sync-status.ts` — the same tolerance already used for `lastCycleId`, `lastFailedCheckpointCount`, etc. No new screen, no wire field (`syncdiag.Record` has nowhere to put them).

`lastDiagnosticsDiscardedCount`, `lastDiagnosticsFailedRemovalCount`, `lastOutboxFailedWriteCount`, `lastDeadLetterCount`, `lastConflictExhaustedCount`, `lastStuckProcessingCount`, `lastOldestPendingAgeMs`, `lastPendingRowCount`. `hasMore` is **derived** in the helper (`lastPendingRowCount > RECONCILE_BACKLOG_BATCH_LIMIT`), not stored — storing a derived boolean is how it goes stale against the count beside it.

**Write-door decision**: these do NOT get their own write. `recordBacklogReadCount` (`headless-sync-cycle.helpers.ts:103`) already performs one full read-modify-write per cycle; it is extended into a single cycle-bookkeeping patch carrying the flush counters and the projection. The flush result reaches it by widening `SyncPendingOperationsResult` (which already returns `{ syncedCount, backlogReadCount }`). Rejected: persisting at `reconcile.helpers.ts:381` — that site is deliberately outside every `withLocalWrite`, and adding a write there puts the shared door on the diagnostics path the surrounding comment exists to keep off it.


### D7 — Headless stage maps to the wire vocabulary only where the correspondence is exact

`HeadlessSyncCycleStage` (7 members: `open`, `bridge_config`, `attempt_started`, `cycle_activated`, `reconcile`, `result_bookkeeping`, `prune`) and the wire's `SYNC_CYCLE_STAGES` (11 members) are genuinely different sets, and nothing in the earlier decisions reconciled them. The wire vocabulary has **no `unknown` member**, so `null` is the only way to say "not known".

**Chosen**: `HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE` maps the five exact correspondences (`open`, `bridge_config`->`config`, `attempt_started`, `cycle_activated`, `prune`) and returns `null` for `reconcile` and `result_bookkeeping`.

**Rejected**: approximating them as `reconcile`->`http` and `result_bookkeeping`->`apply_write`. The `reconcile` leg spans `backlog_read`, `claim_ops`, `http`, `parse_response` **and** `apply_write`, including local SQLite writes through `withLocalWrite`. Reporting `http` for it would describe a write-door jam as a transport failure -- collapsing precisely the distinction this change exists to make. It is also the defect class this change was built to remove: a field that answers falsely is worse than one that answers nothing, exactly as `consecutive_unclosed_cycles` reading `0` beside three `never_closed` outcomes was. At fleet scale it would be worse still, since `last_stage` would cluster on `http` as an artefact of the mapping rather than of reality.

The diagnosis the approximation was protecting is not lost: on that same failure path the error triple fires, and it is the surface actually designed to discriminate -- `error_name` separates `LocalWriteError` from `BridgeTimeoutError` from `ReconcileHttpError`, `error_stage` gives `begin`/`task`/`commit`/`rollback`/`deadline`, and `error_cause` separates `closed_resource` from `lock_contention`.

**Documented follow-up, not scheduled here**: publishing real stage checkpoints from `reconcile.helpers.ts` would let those two stages report an exact sub-stage instead of `null`. That touches a file outside this change's scope.

## Data Flow

```
cycle start ──► getSyncRuntimeStatusSnapshot (previous cycle's facts)
                      │
                      ├─► buildSyncAttemptStartedPatch(prev)  ── writes lastCycleId,
                      │      lastCycleStage, lastCycleStageAt, consecutiveUnclosedCycles,
                      │      and CLEARS the error triple to null
                      │
reconcile ────► buildSyncCycleTelemetry({..., now: Date.now()})
                      │                    └─► previous_cycle.* + elapsed_ms  ──► wire
                      │
                flushSyncDiagnosticsOutbox ──► {attempted, delivered, discarded, failedRemovals}
                      │
apply/prune ──► readOperationLogConvergence(rawDb)   [read-only, no write door]
                      │
                      ▼
        ONE existing runtime-status write  ──► sync_runtime_status
                      │
                      └─► use-background-sync-status ──► settings-screen.helpers ──► tiles
```

`consecutiveUnclosedCycles` is computed purely from the previous snapshot (`prev.isCycleActive ? prev.consecutiveUnclosedCycles + 1 : 0`), which `headless-sync-cycle.helpers.ts:76` already reads before the first status write. The started patch must clear `lastErrorName`/`lastErrorStage`/`lastNativeErrcodeByte` to explicit `null` — `mergeSyncRuntimeStatusPatch` uses `withPatchOverride` for exactly this, and without the clear a three-cycle-old error is reported as the previous cycle's.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/features/sync/operation-log-convergence.helpers.ts` | Create | Terminal/stuck/oldest-pending projection over `operation_log` |
| `src/features/sync/operation-log-convergence.types.ts` | Create | `OperationLogConvergence` result shape |
| `src/features/sync/operation-log-retention.helpers.ts` | Modify | Export `countRowsForStatus` |
| `src/features/sync/sync-runtime-status.helpers.ts` | Modify | Three builders write the seven fields; extended bookkeeping patch |
| `src/features/sync/sync-runtime-status.types.ts` | Modify | Narrow `lastErrorName`/`lastErrorStage` in the **patch**; new counter fields |
| `src/features/sync/sync-runtime-status.constants.ts` | Modify | New defaults in both snapshot constants |
| `src/features/sync/sync-telemetry.types.ts` | Modify | `now` required |
| `src/features/sync/sync-telemetry.helpers.ts` | Modify | Delete `deriveElapsedMs`'s unreachable branch |
| `src/features/sync/reconcile.helpers.ts` | Modify | Pass `now`; return the flush result upward |
| `src/features/sync/reconcile.types.ts` | Modify | Widen `SyncPendingOperationsResult` |
| `src/features/sync/sync-diagnostics-flush.{helpers,types}.ts` | Modify | `delivered` requires `'removed'`; `discarded`, `failedRemovals` |
| `src/features/sync/headless-sync-cycle.helpers.ts` | Modify | Fold flush + projection into the existing bookkeeping write |
| `src/infrastructure/db/sync-diagnostics-outbox/*.{helpers,types}.ts` | Modify | `remove` returns an outcome |
| `src/infrastructure/db/schema*` | Modify | Eight additive nullable columns |
| `src/features/settings/use-background-sync-status.ts` | Modify | Map new columns with `?? 0` / `?? null` |
| `src/features/settings/ui/SettingsScreen/settings-screen.{helpers,types}.ts` | Modify | Convergence tiles beside `backlogReadCount` |
| `tests/features/{sync,settings}/__tests__/`, `tests/infrastructure/db/` | New/Modify | One suite per slice |

## Interfaces / Contracts

```ts
/** Outcome of one durable outbox delete. `'removed'` means the DELETE ran without throwing. */
export type SyncDiagnosticsOutboxWriteOutcome = 'removed' | 'failed';

export interface SyncDiagnosticsFlushResult {
  readonly attempted: number;
  /** 2xx AND a confirmed delete. Never inflated by a swallowed remove failure. */
  readonly delivered: number;
  /** Reports the bridge rejected as malformed and this device then destroyed. */
  readonly discarded: number;
  /** 2xx whose delete failed: the row will be re-sent, replaying one `cycle_id`. */
  readonly failedRemovals: number;
}

export interface OperationLogConvergence {
  readonly deadLetterCount: number;
  readonly conflictExhaustedCount: number;
  /** Rows still `processing` after this cycle's apply-write — orphaned, not in flight. */
  readonly stuckProcessingCount: number;
  readonly oldestPendingAgeMs: number | null;
  /** TRUE row depth, never the `dedupeBy: 'anime_id'` batch size. */
  readonly pendingRowCount: number;
  readonly hasMore: boolean;
}
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (pure) | Seven fields per builder incl. the explicit error-triple clear; `consecutiveUnclosedCycles` increment/reset; `deriveElapsedMs` clamp; vocabulary golden membership | `tests/features/sync/__tests__/` — pure inputs, no DB |
| Unit (store) | `remove` returns `'removed'` on success and `'failed'` when `runSync` throws, still never throwing | Existing fake-`openDatabase` harness |
| Unit (flush) | `delivered` does not move on `'failed'`; `discarded` on 400/413/422; `failedRemovals` on 2xx+failed delete | Fake store/client, `buildFakeStore` default `'removed'` |
| Unit (projection) | Each count, `oldestPendingAgeMs === null` on an empty queue, `hasMore` at the batch-limit boundary | In-memory SQLite |
| Integration | One cycle writes the fields and folds the counters into the single existing write | `headless-sync-cycle` suite |
| UI | Tiles render the new counters | `settings-screen.helpers` pure builder |
| Mutation | `remove`'s catch, the `'removed'` check, the error-triple clear, the `hasMore` comparator, the elapsed clamp | Manual stage-then-mutate per CLAUDE.md #9 |

Every touched file's standing `dharness/*` JSDoc findings are fixed **inside its own slice**, never in bulk.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. All bridge I/O continues through `bridgeClient` (`src/infrastructure/api`); this change adds no transport call and no URL construction.

## Migration / Rollout

No data migration. The eight columns are additive and nullable; a row written before them reads through the established `?? 0` / `?? null` defaults in `use-background-sync-status.ts`, exactly as `lastCycleId` did. No bridge state, no deploy. Each slice is one commit merged locally to `main`; `git revert <sha>` restores prior behavior.

## Open Questions

- [ ] `durable-reconcile-footprint` R2 (cursor advance + confirmation in one transaction) is still unverified. It does **not** block: the projection counts terminal statuses and true row depth, neither of which depends on cursor atomicity. It would matter only if a later change derived "converged" from the cursor.
