# Proposal: Offline Diagnostics Outbox

## Intent

The diagnostic envelope is built correctly and then discarded when the request that carries it fails — and in a local-first app, that request failing IS the normal case.

`drainDiagnosticEvents()` runs at `headless-sync-cycle.helpers.ts:77`, unconditionally, 19 lines before the reconcile POST at `:96`. One call site, no restore path. When the POST throws, the built `client_telemetry` envelope is a local variable the `catch` discards. At the 15-minute background cadence, a day offline delivers 1 post-mortem and destroys ~95 — including `headless_task_missing`, the leading signal for why the background service dies, destroyed precisely in the state that generates it.

Mobile must accumulate these envelopes while offline and hand them to bridge on connect.

## Scope

### In Scope

- `sync_diagnostics_outbox` table in the existing `autoreas-telemetry.db`, opened with `openTelemetryDatabaseSync` and written with synchronous `runSync` (the `sync-cycle-checkpoint` pattern). Cap 100 rows, FIFO evict-oldest in the same statement as the insert.
- Durable capture immediately after `clientTelemetry` is built in `performSyncPendingOperations` (`reconcile.helpers.ts` ~:354), before the POST at `:371`, under the conditions that already gate building it.
- `bridgeClient.postSyncDiagnostics` → `POST /api/sync/diagnostics` (bearer, JSON, strict decode). Bare `2xx` stored; `2xx` on duplicate `cycle_id`, so blind retry is always correct; `400` names the offending field; `503` carries `Retry-After`.
- `BridgeHttpResult` extended with a parsed `retryAfterMs: number | null` inside `request()`.
- Unconditional flush of the oldest undelivered rows inside `performSyncPendingOperations`, gated only by a persisted not-before timestamp compared against the clock at cycle start.
- `degraded: null | "events" | "error_detail" | "previous_cycle"` (second field, after `cycle_id`) reported by `capWireSyncCycleTelemetry` and consumed by BOTH the reconcile body and the outbox row.
- Dual-write rollout: `client_telemetry` stays on the reconcile body while the same envelope also POSTs to the new endpoint.

### Out of Scope

- Any new scheduler, timer, or sleep. JS timers are paused in the headless cycle.
- Changing the ring drain at `:77`, `syncPendingOperations`'s public signature, or `runCoordinatedForegroundSyncCycle`'s no-telemetry asymmetry. Capture stays headless/FGS-only; only flush is universal.
- `sync_quarantine` and the SyncTrace three-clock event log — different artifacts, different code paths, no shared table or ordering dependency.
- OpenSpec bookkeeping repair (see Open Questions).
- Guaranteed delivery. The outbox is bounded; bridge has accepted that some `cycle_id`s never arrive.

## Capabilities

### New Capabilities

- `sync-diagnostics-delivery`: a cycle's diagnostic envelope is durably queued before transmission is attempted, then delivered opportunistically on any later cycle, bounded and evicting.

### Modified Capabilities

- None. `write-failure-diagnostics` governs local write failures (`errcode`/`elapsedMs`/`stage`), not the cycle envelope; its requirements are unchanged.

## Approach

**Write before you send.** The envelope is already built, capped and sanitized at the right place — it simply has nowhere durable to land. One synchronous insert into a file that does not share a failure domain with the shared write door turns a discarded local into evidence. `withLocalWrite` is rejected outright: that is the failure domain the outbox exists to survive.

**Delivery needs no wiring.** `performSyncPendingOperations` is the single function every trigger already funnels through, so an unconditional flush there makes `network_regained`, WS `sync_required`, `app_active`, bootstrap, the FGS 15 s ticker and the headless task all flush opportunities for free.

**Backoff is a clock comparison**, modelled on `sync-cycle-lock.helpers.ts`'s `WHERE expires_at <= ?` — a persisted not-before timestamp read at cycle start, never a `setTimeout`.

**Naming is a constraint, not a preference.** Bare `outbox` is already taken: it means the `operation_log` queue of un-acked local mutations (`loadPendingOutboxRecordIds`, "outbox row" throughout `reconcile.helpers.ts`, and `tests/behaviour/sync/outbox-round-trip.behaviour.test.ts`, which covers that queue and not diagnostics). Every identifier this change introduces MUST carry `diagnostics` — `sync_diagnostics_outbox`, `syncDiagnosticsOutbox`, `diagnostics-outbox-round-trip.behaviour.test.ts` — matching the already-correct change folder name. A bare `outbox` symbol here would read as the mutation queue to the next person, and that misreading is cheap now and expensive later.

No new feature folder is created, so `generate:feature` does not apply.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/sync/reconcile.helpers.ts` | Modified | Durable capture after `clientTelemetry` builds (~:354); unconditional flush attempt |
| `src/infrastructure/db/sync-diagnostics-outbox/` | New | Table + synchronous store mirroring `sync-cycle-checkpoint`'s file/connection pattern |
| `src/infrastructure/api/bridge-client/` | Modified | `postSyncDiagnostics`; `retryAfterMs` parsed on `BridgeHttpResult` |
| `capWireSyncCycleTelemetry` (sync telemetry helpers) | Modified | Returns the tier it shed to, as `degraded` |
| `src/features/sync/headless-sync-cycle.helpers.ts` | Unchanged | Capture ordering at `:72-78` is already correct |
| `tests/features/sync/__tests__/`, `tests/infrastructure/api/` | New | Unit suites: store, envelope→row projection, flush-candidate selection, `postSyncDiagnostics` |
| `tests/behaviour/sync/diagnostics-outbox-round-trip.behaviour.test.ts` | New | Headline behavioural proof, modelled on the existing `outbox-round-trip` shape: real SQLite, real drizzle, real write door, real `bridgeClient`, only `fetch` faked via `installFakeBridge`. Both roots sit under the single `roots: ['<rootDir>/tests']` entry — no Jest config change |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bridge endpoint not built yet; every flush fails | High until bridge ships | A flush failure MUST NOT fail the cycle; non-2xx leaves the row queued; the cap bounds growth; dual-write keeps today's delivery path intact |
| `BridgeHttpResult` exposes no headers, so `Retry-After` is unreadable today | Certain | Parse it inside `request()`; the Bridge Boundary rule forbids feature code from touching the response itself |
| `degraded` computed twice and drifting between body and row | Medium | Single source: `capWireSyncCycleTelemetry` returns the shed tier |
| FGS 15 s ticker evicts a backlog faster than the cap assumes | Medium | Accepted by bridge; cap sized for the 15-min headless cadence (96/day) |
| A bare `outbox` identifier is read as the `operation_log` mutation queue | Medium | Hard naming constraint: every new symbol, table and test filename carries `diagnostics` (see Approach) |
| Staged files inherit `dharness` JSDoc debt | High | JSDoc written as part of each edit; never bulk (constraint 12) |
| `tasks.md` drift misleads a reviewer trusting checkboxes over code | Medium | Recorded under Open Questions; not repaired here |

## Rollback Plan

Revert the commit. The change is additive: the table is read only by its own flush path, and dual-write means the reconcile body still carries `client_telemetry` unchanged, so reverting restores exactly today's behaviour with no data migration and no bridge coordination. Leave `sync_diagnostics_outbox` in place if it already exists — dropping a table in `autoreas-telemetry.db` is the riskier operation and an unread table is inert.

## Dependencies

- Bridge `POST /api/sync/diagnostics` is contractually agreed but **not implemented**. Dual-write is what makes shipping mobile first safe.
- None on the three other active changes. `sync_quarantine` (`durable-reconcile-footprint`) is independent with evidence: quarantine is capture-before-advance for INBOUND changes rejected at the merge boundary, cursor-gated and keyed off `bridge_changes`; this outbox stores the device's OWN OUTGOING envelope, keyed on `cycle_id`, read only by the new endpoint. No shared table, no shared write path, no code-path reference either way.
- Delivery is a local merge to `main`. No PR, push or deploy.

## Open Questions (raised, not scoped here)

1. **OpenSpec drift.** `background-sync-bounded-awaits` and `core-sync-behaviour-suite` are fully implemented with every `tasks.md` box unchecked; `durable-reconcile-footprint` is done except `sync_quarantine`. Recommended housekeeping: archive the first two, narrow the third. Deliberately not folded into this change.
2. **`sync-trace-observability`'s future.** Two separate claims, and only one survives.
   - *Artifact identity holds*: SyncTrace's three-clock ULID event log is different data from the `client_telemetry` envelope. No overlap, no dependency.
   - *Its scope rationale does not hold.* `openspec/changes/2026-09-04-sync-trace-observability/proposal.md`'s Out-of-Scope bullet argues "the bridge already holds ~80% of the timeline… correlation by header is cheaper than ingestion and needs no bridge change." That presumes a bridge-side capture exists to correlate against via `X-Sync-Cycle-Id` — true only when the reconcile request reaches the bridge. This change exists for the case where it does not, and offline there is nothing to correlate against.

   The two should still ship separately, but **for cost and size**: SyncTrace needs two new native module functions and therefore an APK rebuild; this change needs neither. Follow-up: correct that bullet's rationale **text** (the decision stands, the reason does not) so nobody re-litigates a settled call on a false premise. Open product question: is SyncTrace still wanted now that the outbox answers the offline case?

## Success Criteria

- [ ] A reconcile cycle whose `bridgeClient.reconcile` throws still leaves a durable `sync_diagnostics_outbox` row — the direct inversion of the failure this change exists to close.
- [ ] The row is present even though the ring was already drained at `:77` (mutation-proven).
- [ ] FIFO eviction holds at the exact 100-row boundary (off-by-one, mutation-proven).
- [ ] The store's write path demonstrably does NOT go through `withLocalWrite`.
- [ ] Not-before is a clock comparison at cycle start, never a `setTimeout` (mutation-proven).
- [ ] `degraded` on the reconcile body and on the outbox row come from the same `capWireSyncCycleTelemetry` return.
- [ ] A behaviour test queues a row under a faked bridge failure, then drains it on a second cycle under a faked success.
- [ ] `npm run validate` green. Regression floor **re-measured at task time** — existing artifacts disagree (109/654 vs 142/953); do not hardcode either.
