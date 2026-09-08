# Exploration: Offline Diagnostics Outbox

> Mirrored from Engram `sdd/2026-09-08-offline-diagnostics-outbox/explore` (obs 9228).
> Every claim below was verified against the filesystem, not against `tasks.md` checkboxes.

## Current State

The diagnostic post-mortem for a sync cycle is built and transmitted, never durably queued.

In `headless-sync-cycle.helpers.ts:72-78`, `runCycleBody` captures `telemetryContext` — a snapshot of the PREVIOUS cycle's outcome via `getSyncRuntimeStatusSnapshot`, plus `drainDiagnosticEvents()` which empties the in-memory ring — BEFORE the two writes at `:84`/`:87` that would otherwise overwrite the very fields the snapshot read. That context flows into `performSyncPendingOperations` (`reconcile.helpers.ts:341-354`), which builds the wire envelope (`buildSyncCycleTelemetry` → `resolveClientTelemetry`, capped at 4 KiB by `capWireSyncCycleTelemetry`) and attaches it to the SAME reconcile POST body as `client_telemetry` (`reconcile-request.helpers.ts:43`).

If that POST throws (line 371 — offline being the common case), the built envelope is a local variable discarded when the `catch` at `reconcile.helpers.ts:458` / `headless-sync-cycle.helpers.ts:121` runs. **Nothing durable was ever written.** Verified: `drainDiagnosticEvents` (`sync-diagnostic-store.helpers.ts:65-70`) has exactly one call site and no restore path.

### Trigger topology

Three call paths converge on the same low-level executor, `syncPendingOperations` (`reconcile.helpers.ts:97`), but only two pass a `telemetryContext` today:

- `runHeadlessSyncCycle` (`headless-sync-cycle.helpers.ts:202`) — invoked by BOTH the WorkManager background task AND the Notifee foreground-service ticker (`notifee-foreground-service-adapter.helpers.ts:89-92`, every `FOREGROUND_SYNC_INTERVAL_MS` = 15 s while the FGS runs). Both pass `telemetryContext`, so both are diagnostics-eligible cycles.
- `runCoordinatedForegroundSyncCycle` (`sync-facade.helpers.ts:67-119`) — invoked by `requestSync` from WS `sync_required`/`anime_changed`, `network_regained` (`use-sync-runtime.ts:226-244`), `app_active`, and `bootstrap`. Calls `syncPendingOperations(rawDb)` with **no** `telemetryContext`; it never builds or sends `client_telemetry` at all. This is a pre-existing, deliberate asymmetry: this path runs only while the app is foregrounded, where a failure is already visible without off-device instrumentation.

### Existing precedents to reuse

- **`sync-cycle-checkpoint`** (`src/infrastructure/db/sync-cycle-checkpoint/`): a SEPARATE SQLite file (`autoreas-telemetry.db`), opened with `useNewConnection: true, enableChangeListener: false`, written with **synchronous** `runSync` against a native `busy_timeout` (250 ms) instead of the app's promise-based write queue — because JS timers and the shared write queue are exactly what can be jammed during the failure this instruments. Its comment states the file "has no migrations" and uses inline `CREATE TABLE IF NOT EXISTS`. Its table is a hard singleton (`id INTEGER PRIMARY KEY CHECK (id = 1)`), so it cannot queue as-is.
- **`sync-diagnostic-store` ring** (`sync-diagnostic-events.constants.ts:67`): bounded at `SYNC_DIAGNOSTIC_EVENT_RING_SIZE = 20`, coalesces repeats by `(source, event, cause)`, evicts oldest-first. The closest existing precedent for bounded evict-oldest sizing.
- **`sync-cycle-lock`** (`sync-cycle-lock.helpers.ts`): the existing precedent for a **persisted clock comparison instead of a timer** — a conditional UPSERT with `WHERE expires_at <= ?`, claimed at cycle start, never a `setTimeout`-driven wait. Exactly the shape the Retry-After not-before timestamp needs.

`BridgeClient` exposes one method per endpoint, all funnelling through one internal `request()` that owns timeout/`AbortController` (`bridge-client.helpers.ts:55-121`). Its `BridgeHttpResult` (`bridge-client.types.ts:56-63`) carries `ok`, `status`, `data`, `rawBody`, `url` — **no response headers**. Nothing in the codebase reads `response.headers`.

## Affected Areas

| Area | Impact |
|---|---|
| `src/features/sync/reconcile.helpers.ts` (`performSyncPendingOperations`) | Durable write immediately after `clientTelemetry` is built (:341-354), before `bridgeClient.reconcile` at :371; also the home of the unconditional flush attempt |
| `src/infrastructure/db/` new outbox store | New table in `autoreas-telemetry.db`, mirroring the checkpoint store's file/connection/synchronous-write pattern |
| `src/infrastructure/api/bridge-client/` | New `postSyncDiagnostics` method mirroring `postActiveSeasonRating`; `BridgeHttpResult` extended to surface `Retry-After` |
| `src/features/sync/headless-sync-cycle.helpers.ts` | No change to the drain; capture ordering is already correct |
| `tests/features/sync/__tests__/`, `tests/infrastructure/api/`, `tests/behaviour/sync/` | New suites |

## Overlap With The Four Active OpenSpec Changes

Verified against the filesystem. There is real drift between OpenSpec bookkeeping and the codebase.

| Change | `tasks.md` | Code state (verified) | Recommendation |
|---|---|---|---|
| `background-sync-bounded-awaits` | All unchecked | **Fully implemented.** `AbortController`+timer at `bridge-client.helpers.ts:74-79`, `spec.timeoutMs` override present, `minimumInterval: BACKGROUND_SYNC_MINIMUM_INTERVAL_MINUTES` (named minutes constant) at `background-sync.constants.ts:17`, cycle deadline at `headless-sync-cycle.helpers.ts:222-227` | Archive. No overlap. |
| `core-sync-behaviour-suite` | All unchecked | **Fully implemented.** `tests/support/{sqlite-adapter,drizzle-test-factory,fake-bridge,sync-fixtures}.helpers.ts` and `tests/behaviour/sync/{chapter-mutation,inbound-changes,outbox-round-trip,season-rating}.behaviour.test.ts` all exist | Archive. No overlap. |
| `durable-reconcile-footprint` | All unchecked | **Mostly implemented.** A10 fix done (`apply-remote-changes.helpers.ts:27-33`, hoisted unconditional existence check with a comment naming A10). D1 one-transaction cursor+confirmation done (`reconcile.helpers.ts:437-450`). Dead 409 branch gone. **`sync_quarantine` does not exist anywhere.** | Narrow to exactly `sync_quarantine`. Do NOT fold into the outbox — quarantine is capture-before-cursor-advance for REJECTED remote changes; the outbox is durable delivery of the cycle's own diagnostics envelope. |
| `sync-trace-observability` | Not started | **Not implemented** — no `src/features/sync/sync-trace/`, no `X-Sync-Cycle-Id` anywhere in `src/`, no `getElapsedRealtime`/`getUptimeMillis` in `modules/` | **Does not overlap and needs no reversal.** Its "Out of Scope: uploading the trace" line refers to a DIFFERENT artifact — a full three-clock, ULID-keyed per-event log — not the `client_telemetry` envelope this change delivers. Complementary, not the same decision revisited. Whether it is still wanted at all is a product question for `sdd-propose` to raise. |

**Drift note**: per CLAUDE.md's "Code is Law", this exploration trusted the filesystem, not the checklists. The orchestrator should reconcile/archive the first two and narrow the third so `openspec/changes/` stops overstating remaining work.

## Q2 — Where does the outbox live?

1. **New table in the existing `autoreas-telemetry.db`** — `sync_diagnostics_outbox`, opened via the same `openTelemetryDatabaseSync` helper the checkpoint store uses, written with the same synchronous `runSync` pattern.
   - **Pros**: reuses infrastructure already proven to satisfy "must not share a failure domain with the shared write door". No new open-failure mode, no new file to reason about. The checkpoint file already establishes the inline `CREATE TABLE IF NOT EXISTS` / no-migrations pattern. Smallest possible change.
   - **Cons**: couples a bounded, evicting table's lifecycle to a file whose only occupant is a fixed singleton row — mitigated by using the same tested opener both rely on.
   - **Effort**: Low.
2. **New sibling database** (`autoreas-diagnostics-outbox.db`) — total file-level isolation, but a brand-new file needing its own open/connect/busy-timeout reasoning, duplicating solved work. Against the "smallest design" directive. Effort: Medium.
3. **A table in the main `autoreas.db` via `withLocalWrite`** — rejected outright. That is precisely the failure domain the outbox exists to survive; reusing it silently reintroduces the bug being fixed.

**Recommendation: Option 1.**

## Q3 — What gets persisted, and when?

Insertion point: immediately after `clientTelemetry` is built in `performSyncPendingOperations` (`reconcile.helpers.ts`, just after :354), guarded by the same conditions that already gate building it (`telemetryContext` present AND `resolveClientTelemetry` returned non-null — i.e. the user's kill switch is on and the payload fit under the cap). This is BEFORE `bridgeClient.reconcile` at :371, so the row:

- captures exactly the envelope that would have gone on the wire, already capped and sanitized;
- survives whether the POST throws, times out, or the response never parses;
- requires **no reordering** of the existing capture-before-overwrite logic at `headless-sync-cycle.helpers.ts:72-78` — that ordering is already correct. The bug is purely that the correctly-captured envelope has nowhere durable to land.

Row shape mirrors the wire envelope directly: `cycle_id` (unique), the full `client_telemetry` JSON blob (already ASCII and size-bounded), and `created_at` for FIFO ordering.

`degraded` must NOT be recomputed independently. Extend `capWireSyncCycleTelemetry` to also report which tier it shed to, so the reconcile body and the outbox row take the same value from the same function.

## Q4 — When does delivery happen?

No new scheduler and no new wiring. `performSyncPendingOperations` is the single low-level function every existing trigger already funnels through (headless task, FGS 15 s ticker, WS `sync_required`, `network_regained`, `app_active`, `bootstrap`).

Attaching an **unconditional** flush attempt inside that function — POST the oldest N undelivered rows via `bridgeClient.postSyncDiagnostics`, gated only by the persisted not-before timestamp — makes every existing trigger a flush opportunity for free, including exactly the "when it connects" moments the user named (`network_regained`, WS-driven `sync_required`).

CAPTURE stays gated on `telemetryContext` presence (headless/FGS only, matching today's asymmetry and the user's core scenario of diagnosing the *background* service). FLUSH runs on every cycle regardless of trigger, so a foreground-only trigger can drain a backlog a background cycle queued earlier.

## Q5 — Bounded size and eviction

The FGS ticker fires every 15 s while registered, independent of connectivity, so a long offline stretch with the FGS active attempts far more cycles than the 15-minute headless cadence implies. The existing ring already establishes the precedent of a small fixed cap with oldest-first eviction rather than sizing for a worst case.

**Recommendation: cap 100 rows, FIFO evict-oldest-on-insert**, trimmed in the same synchronous statement as the insert — no separate cleanup pass, matching the checkpoint store's zero-background-job design. 100 rows covers just over a full day of the pure 15-minute background cadence (96/day), matching the user's own "a day offline" framing, and stays well under 100 KB at the measured ~474 B per envelope. If the FGS dominates and evicts faster, that is already an accepted characteristic — bridge has agreed some `cycle_id`s will never arrive.

## Q6 — Does the ring drain change?

**No.** The unconditional drain at `:77` stays as-is. Once the built envelope is written durably BEFORE the request is attempted, the ring having already been drained is no longer a loss — the data it fed into is safe elsewhere. Making the drain conditional would reintroduce complexity (what does "conditional" mean when the same drained events also feed the reconcile body's `client_telemetry`, which is attempted unconditionally?) without fixing anything the durable write does not already fix.

This is the one place a mutation test must prove: **the outbox row for a cycle is present even when the ring was drained AND the reconcile POST failed.**

## Q7 — Test strategy

- **Pure helpers** (envelope→row projection, row→flush-candidate selection): ordinary RED/GREEN.
- **New outbox store** (mirrors `sync-cycle-checkpoint`'s test shape): insert-and-read; FIFO eviction at the exact cap boundary (off-by-one — mutation-worthy per constraint 9); and a test proving the write path does NOT go through `withLocalWrite`.
- **Not-before clock comparison** (modelled on `sync-cycle-lock.helpers.ts`'s `WHERE expires_at <= ?`): async/lock category — **mandatory mutation cycle**. Must assert a comparison against `Date.now()` at cycle start, never a `setTimeout`.
- **New `bridgeClient.postSyncDiagnostics`**: unit test mirroring the existing shape for `reconcile`/`postActiveSeasonRating` — timeout behaviour, non-2xx handling, and parsing `Retry-After` from a 503 once `BridgeHttpResult` is extended.
- **Headline regression test**: a reconcile cycle whose `bridgeClient.reconcile` throws must still leave a durable outbox row afterward. This is the direct inversion of the failure the change exists to close.
- **Error/timeout classification**: reuse `causeFromError` / `classifySyncCycleErrorCause` rather than inventing a second classifier.
- **Regression floor**: re-measure via `npm test` at task-writing time. Engram shows drift between the 109/654 figure baked into the four existing proposals and a 142/953 count measured 2026-09-05. Do not hardcode either.

## Recommendation

One new table (`sync_diagnostics_outbox`) in the already-separate `autoreas-telemetry.db`, written synchronously at the exact point `clientTelemetry` is already built in `performSyncPendingOperations` (before the reconcile POST), flushed opportunistically and unconditionally in that same function on every cycle regardless of trigger (gated only by a persisted not-before timestamp), through one new `bridgeClient.postSyncDiagnostics` method.

No new scheduler. No change to the ring's drain. No change to `syncPendingOperations`'s public signature.

## Risks

- **`BridgeHttpResult` cannot currently surface `Retry-After`.** Nothing reads `response.headers`; the type carries only `ok/status/data/rawBody/url`. It must be extended (e.g. `retryAfterMs: number | null` parsed inside `request()`) before the not-before commitment already made to bridge can be implemented at all. Concrete and verified, not a formality. The Bridge Boundary rule forbids feature code from doing this itself.
- **`tasks.md` drift** across three of four active changes could mislead a reviewer who trusts the checklist over the code.
- **FGS-driven volume**: up to 4 capture cycles/minute vs 1/15 min. The cap is sized for the headless cadence deliberately, per bridge's acceptance that eviction is expected.
- **`degraded` drift** if computed separately from `capWireSyncCycleTelemetry`'s shedding decision.
- **Stale regression-floor numbers** in existing artifacts.

## Ready for Proposal

Yes. All seven questions have code-verified answers. The design fits inside one existing function plus one small store plus one `bridgeClient` method — no multi-part restructuring.
