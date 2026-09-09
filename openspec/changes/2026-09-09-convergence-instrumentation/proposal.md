# Proposal: Convergence Instrumentation

## Intent

Sync cannot distinguish a converged device from a permanently stuck one. Seven runtime-status fields are dead by construction (`sync-runtime-status.helpers.ts:27-70`), so every `previous_cycle.*` bridge column is NULL; `now` is never passed (`reconcile.helpers.ts:347-357`), so `elapsed_ms` is unreachable; the outbox `remove()` swallows failure while still counting `delivered`, replaying one `cycle_id` 600,055 ms apart; and `dead_letter` / `conflict_exhausted` are counted nowhere before retention deletes them.

## Cross-Repo Decision — Mobile-Only By Schema, Not By Deferral

`syncdiag.Record` (`autoreas-bridge/internal/observability/syncdiag/types.go:50-94`) is a closed struct and it decides the split:

| Deliverable | Existing bridge field | Wire |
|---|---|---|
| 7 dead fields | `ConsecutiveUnclosedCycles`, `PreviousCycle.{CycleID,LastStage,ErrorName,ErrorStage,NativeErrcodeByte,StartedAt}` | reachable today |
| `elapsed_ms` | `PreviousCycle.ElapsedMS` | reachable today |
| `failedWriteCount`, convergence projection | none | mobile-only |

Deliverables 1–2 need **no bridge change**: those columns exist and are NULL only because mobile never writes them. Deliverables 3–4 have no field in `Record`; Go drops unknown keys, so sending them buys a `204` and silence. They land in `sync_runtime_status` and the existing `SettingsScreen` — the shipped pattern for `lastBacklogReadCount`. A later coordinated bridge change owns the wire extension.

Governing asymmetry — two opposite, unobservable losses on one endpoint. An unknown **key** is dropped by `json.Unmarshal` and the envelope is still stored `204`. An out-of-vocabulary **value** in a known key (`vocabulary.go`, 11 closed sets) is rejected `400`, and `sync-diagnostics-flush.helpers.ts:96-99` then removes the row and continues without incrementing `delivered` — the report is permanently destroyed client-side and no counter on either side records it. Emitted values MUST stay inside `syncStages` (11), `syncErrorNames` (6), `syncErrorStages` (6).

## Scope

**In:** the three patch builders write the seven fields; pass `now`; `remove()` reports deletion so `delivered` counts only confirmed deletes and `failedWriteCount` becomes observable; an `operation_log` convergence projection reusing `countRowsForStatus` (`dead_letter`, `conflict_exhausted`, stuck `processing`, oldest-pending age, explicit `has_more`).

**Out:** the `X-Sync-Cycle-Id` header (owned by `sync-trace-observability`); any open/tolerant-reader body or cross-repo vocabulary codegen; any new screen; reconciling stale `tasks.md` in `background-sync-bounded-awaits` and `core-sync-behaviour-suite`; editing `autoreas-bridge`.

**Out — `lastBacklogReadCount` / `lastPrunedOperationsCount` on the wire.** Both are already observable on the device end to end (`headless-sync-cycle.helpers.ts:103,115,138` → `use-background-sync-status.ts:57-58` → `settings-screen.helpers.ts:125-126`). `Record` has no field for either, so `json.Unmarshal` drops them and they never reach `device_sync_diagnostics`; `request_captures` retains the raw body but is a bounded, pruned debug capture (`requestcapture/store.go:12-13`), not a durable path. Sending them would manufacture two fields that look delivered and land nowhere — precisely the defect this change exists to remove. The client half is a one-line addition if and when the bridge grows the columns.

## Capabilities

### New Capabilities
- `sync-convergence-observability`: terminal-failure and true backlog-depth projection over `operation_log`, kept distinct from bounded-batch `pending_ops_count`.
- `sync-cycle-telemetry-completeness`: the seven fields and `elapsed_ms` carry values, constrained to the bridge's closed vocabularies.

### Modified Capabilities
- `sync-diagnostics-delivery`: "removed exactly once" becomes observable — `delivered` requires a confirmed delete.

## Approach

Four vertical TDD slices, one commit each, RED → GREEN → MUTATE: builders → `now` → outbox acknowledgement → convergence projection with its Settings surface. No new feature folder; the projection extends `src/features/sync`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/features/sync/sync-runtime-status.helpers.ts` | Modified | builders write the seven fields |
| `src/features/sync/reconcile.helpers.ts` | Modified | pass `now` to `buildSyncCycleTelemetry` |
| `src/features/sync/sync-diagnostics-flush.helpers.ts` | Modified | count `delivered` on confirmed delete |
| `src/infrastructure/db/sync-diagnostics-outbox/` | Modified | `remove()` returns an outcome |
| `src/features/sync/operation-log-retention.helpers.ts` | Modified | reuse `countRowsForStatus` |
| `src/features/settings/` | Modified | render the projection |
| `tests/features/{sync,settings}/__tests__/` | New/Modified | one suite per slice |

Dropping the wire half of `lastBacklogReadCount` / `lastPrunedOperationsCount` removes one slice of five and touches no file the remaining four do not already touch, lowering the footprint against the 800-line review budget.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| An out-of-vocabulary stage/error value is rejected `400` and the envelope is then silently discarded client-side, unrecorded on both sides | Med | mirror the three closed sets as TS unions constrained at build time, so a drifting symbol cannot reach the wire |
| Changed `delivered` semantics break existing callers and tests | High | enumerate every caller and assertion first; fix inside the same slice |
| R2 of `durable-reconcile-footprint` is unverified | Med | re-check in design; blocks only if convergence needs cursor atomicity |
| `dharness/*` JSDoc debt on each touched file | High | pay per file inside its slice, never in bulk |

## Rollback Plan

Each slice is one commit merged locally to `main`; `git revert <sha>` restores prior behavior. No migration, no bridge state, no deploy.

## Dependencies

None blocking. `autoreas-bridge` is read-only for this change.

## Success Criteria

- [ ] A delivered report shows non-null `previous_cycle.*` and `elapsed_ms` server-side.
- [ ] A failed `remove()` never increments `delivered`, and `failedWriteCount` is readable.
- [ ] Settings shows terminal-failure counts, stuck `processing`, oldest-pending age, and `has_more`.
- [ ] `npm run validate` is green and every new guard survives its mutation check.
