# Tasks: Offline Diagnostics Outbox

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1266 (design.md File Impact: ~506 src + ~760 tests) |
| 400-line budget risk | High (well over the default 400-line guard; each slice individually fits the session's granted 800-line budget: Slice A ~599 lines, ~201-line margin; Slice B ~667 lines, ~133-line margin — `dharness` JSDoc debt on touched files could erode either margin) |
| Chained PRs recommended | No — this repo has no PR chain; delivery is a local merge to `main` (no push, no `adb`) |
| Suggested split | Single change, two internally-ordered slices as sequential local commits on `feat/offline-diagnostics-outbox` |
| Delivery strategy | auto-chain |
| Chain strategy | pending — not applicable under the local-merge delivery model (`openspec/config.yaml` `rules.proposal` forbids planning a PR/push/deploy workflow); ordering below is task/commit order, not stacked branches |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| A | Diagnostics outbox store, bridge-client `Retry-After` parsing + `postSyncDiagnostics`, fake-bridge header extension (Phases 1-5) | Slice A local commit (~599 lines) | `bunx jest tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts tests/infrastructure/api/bridge-client-retry-after.test.ts tests/infrastructure/api/bridge-client.helpers.test.ts tests/support/__tests__/fake-bridge.test.ts` | N/A — real SQLite via `tests/support/sqlite-adapter.helpers.ts` (read-only); no device/adb | `git revert`; touches zero files under `src/features/**`; the reconcile path is byte-identical to today |
| B | `degraded` on the wire type, `sync-diagnostics-flush.*`, the two calls in `reconcile.helpers.ts`, behaviour proof (Phases 6-11) | Slice B local commit (~667 lines, depends on A for the store and `postSyncDiagnostics`) | `bunx jest tests/features/sync/__tests__/sync-telemetry-degraded.test.ts tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts tests/features/sync/__tests__/sync-diagnostics-timing-order.test.ts tests/features/sync/reconcile.helpers.test.ts` | `bunx jest tests/behaviour/sync/diagnostics-outbox-round-trip.behaviour.test.ts` — real SQLite, real drizzle, real write door, real `bridgeClient`, only `fetch` faked; no device/adb | `git revert`; only two statements sit before the untouched `try` at `reconcile.helpers.ts:370` — removing them restores original control flow exactly |

## Slice A — Infrastructure

### Phase 1: Bridge Client — Defensive Header Read & `Retry-After` Parsing (Decision 2; Decision 8, guard half)

- [x] 1.1 RED `tests/infrastructure/api/bridge-client-retry-after.test.ts`: a header-less `Response` double — today's `tests/support/fake-bridge.helpers.ts` (read-only) shape — does not throw and yields `retryAfterMs: null`. This is the regression guard for the verified breakage in Decision 8.
- [x] 1.2 GREEN `src/infrastructure/api/bridge-client/bridge-client.helpers.ts`: defensive read `typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null`.
- [x] 1.3 RED (same suite): every remaining row of Decision 2's table for `parseRetryAfterMs` — delta-seconds (`"120"` → `120_000`), HTTP-date in the future, HTTP-date already past (→ `0`), absent/empty/negative/fractional/`"soon"`/unparseable (→ `null`), and any accepted value clamped to `SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS`.
- [x] 1.4 GREEN `src/infrastructure/api/bridge-client/bridge-url.helpers.ts`: pure `parseRetryAfterMs(rawValue, now)` — strict `/^\d+$/` delta-seconds branch tried and matched FIRST, `Date.parse` only as fallback.
- [x] 1.5 GREEN `src/infrastructure/api/bridge-client/bridge-client.constants.ts`: `SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS = 3_600_000`.
- [x] 1.6 GREEN `src/infrastructure/api/bridge-client/bridge-client.types.ts`: `retryAfterMs: number | null` on `BridgeHttpResult`.
- [x] 1.7 GREEN `bridge-client.helpers.ts`: wire `parseRetryAfterMs(headerValue, now)` into `request()`'s returned result.
- [x] 1.8 MUTATE (guard cycle #7 — stage first, then mutate per constraint 9): `git add` the file while green; delete the strict `/^\d+$/` branch so `Date.parse` runs first; run only the `"2000"` case and confirm it goes RED (asserts `2_000_000` ms, not a year-2000 date); `git checkout -- <file>` to restore. Never `git checkout HEAD --` while the feature is uncommitted.

### Phase 2: Fake Bridge Extension (Decision 8, second half)

- [x] 2.1 RED `tests/support/__tests__/fake-bridge.test.ts`: a queued response's `headers` are replayed via a case-insensitive `get`; a response queued without `headers` still resolves without throwing.
- [x] 2.2 GREEN `tests/support/fake-bridge.types.ts`: `QueuedBridgeResponse.headers?: Record<string, string>`.
- [x] 2.3 GREEN `tests/support/fake-bridge.helpers.ts`: synthesize a minimal case-insensitive `headers.get` from the optional map when present, absent otherwise.
- [x] 2.4 Verify: run the four existing behaviour suites under `tests/behaviour/sync/` (read-only) unchanged and green — none may regress now that `request()` reads `response.headers` inside their `installFakeBridge` flow.

### Phase 3: `postSyncDiagnostics` Adapter Method

- [x] 3.1 RED `tests/infrastructure/api/bridge-client.helpers.test.ts`: `postSyncDiagnostics` sends bearer + JSON to the `syncDiagnostics` path; honors a `timeoutMs` override via `BridgeRequestOptions`; surfaces a non-2xx `BridgeHttpResult` without throwing — mirroring the existing `postActiveSeasonRating` cases in the same file (read-only pattern).
- [x] 3.2 GREEN `src/infrastructure/api/bridge-client/bridge-client.constants.ts`: `syncDiagnostics` path constant.
- [x] 3.3 GREEN `src/infrastructure/api/bridge-client/bridge-client.types.ts`: `postSyncDiagnostics` on `BridgeClient`.
- [x] 3.4 GREEN `bridge-client.helpers.ts`: implement `postSyncDiagnostics` through the shared `request()`.
- [x] 3.5 GREEN `src/infrastructure/api/bridge-client/index.ts`, `src/infrastructure/api/index.ts`: re-export the new surface.
- [x] 3.6 Verify at commit time: the pre-commit `fallow` dead-code audit does not flag `postSyncDiagnostics` as unused via the barrel `ignoreExports` rule — the audit exits 1 on a finding, and this method has no production caller until Slice B (design Open Question).

### Phase 4: Diagnostics Outbox Store (Decisions 3, 6, 7)

- [x] 4.1 RED `tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts` (pattern: `tests/infrastructure/db/sync-cycle-checkpoint.helpers.test.ts`, read-only): enqueue-then-read via `readFlushCandidates`; `remove` deletes by `cycle_id`; the store's write path never calls `withLocalWrite` (spy/assert zero invocations).
- [x] 4.2 GREEN `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.constants.ts`: DDL for `sync_diagnostics_outbox` and `sync_diagnostics_outbox_state`, the insert/select/remove/gate SQL strings, `SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS = 100`, `SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS = 250`.
- [x] 4.3 GREEN `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.types.ts`: row, entry, store params, and the `SyncDiagnosticsOutboxStore` interface (`enqueue`, `readFlushCandidates`, `remove`, `deferUntil`, `getFailedWriteCount`).
- [x] 4.4 GREEN `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.helpers.ts`: `createSyncDiagnosticsOutboxStore` on a private `useNewConnection: true, enableChangeListener: false` connection; all reads/writes synchronous (`runSync`/`getAllSync`).
- [x] 4.5 GREEN `src/infrastructure/db/sync-diagnostics-outbox/index.ts`: pure barrel.
- [x] 4.6 Verify at commit time: `execSync` accepts the multi-statement `DROP TRIGGER IF EXISTS ...; CREATE TRIGGER ... BEGIN ... END` block under the installed `expo-sqlite` version (design Open Question).
- [x] 4.7 RED (same suite): eviction at exactly the 100/101-row boundary — the 101st insert evicts the single oldest row and the count stays at 100; an insert below the cap evicts nothing and the count grows by exactly one.
- [x] 4.8 MUTATE (guard cycle #1): `git add` while green; delete the `WHEN (...) > ${MAX}` trigger condition (or the whole trigger); run only the 100/101 boundary test and confirm RED; `git checkout -- <file>` to restore.
- [x] 4.9 RED (same suite): `readFlushCandidates(limit, now)` returns `[]` when the persisted `not_before` is in the future relative to `now`, and returns rows once `now >= not_before`.
- [x] 4.10 MUTATE (guard cycle #2): delete the `WHERE COALESCE((SELECT not_before ...), 0) <= ?` gate clause; run only the gate test and confirm RED — this is the proof the backoff is a clock comparison, not a timer; restore.
- [x] 4.11 RED (same suite): re-inserting the same `cycle_id` — simulating `syncPendingOperations`'s rerun loop, `reconcile.helpers.ts:119-126` (read-only) — leaves `created_at` unchanged.
- [x] 4.12 MUTATE (guard cycle #6): change `ON CONFLICT(cycle_id) DO NOTHING` to `DO UPDATE`; run only the rerun test and confirm RED; restore.

### Phase 5: Slice A Verification

- [x] 5.1 Run `npm test` on the pre-Slice-A tree and record the exact current suite/test counts as the baseline. Do not trust the recorded `109/654` or `142/953` figures from other artifacts — they disagree.
- [x] 5.2 `npm run validate` (lint + typecheck + test) green across every file touched in Phases 1-4. JSDoc for every newly staged export is written as part of its edit (constraint 12), never as a bulk pass — this staged set inherits standing `dharness/require-jsdoc` / `require-variable-jsdoc` debt on any pre-existing file it touches (e.g. `bridge-client.helpers.ts`, `bridge-client.types.ts`).
- [x] 5.3 Commit Slice A with a conventional commit message (e.g. `feat(sync): add diagnostics outbox store and bridge Retry-After parsing`). Touches zero files under `src/features/**`; the reconcile path behaves exactly as before this commit.

## Slice B — Feature Wiring

### Phase 6: `degraded` On The Wire Type (Decision 1)

- [ ] 6.1 RED `tests/features/sync/__tests__/sync-telemetry-degraded.test.ts`: each shedding branch (`events` → `error_detail` → `previous_cycle`) sets the matching tier; `degraded` is key 2 in the `JSON.stringify` output — assert on the serialized string, not the object; `measureWireBytes` counts the `degraded` key.
- [ ] 6.2 GREEN `src/features/sync/sync-telemetry.types.ts`: `SyncCycleTelemetryDegradedTier = null | 'events' | 'error_detail' | 'previous_cycle'`; `degraded` as the second key of `WireSyncCycleTelemetry`.
- [ ] 6.3 GREEN `src/features/sync/sync-telemetry.helpers.ts`: `toWireSyncCycleTelemetry` emits `degraded: null`; each branch in `capWireSyncCycleTelemetry` sets the shed tier on the intermediate object BEFORE `measureWireBytes` runs, so byte accounting includes it (design: setting it after under-reports by up to 12 bytes).

### Phase 7: Sync Diagnostics Flush — Constants & Timing Chain

- [ ] 7.1 GREEN `src/features/sync/sync-diagnostics-flush.constants.ts`: `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE = 3`, `SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000`.
- [ ] 7.2 RED→GREEN `tests/features/sync/__tests__/sync-diagnostics-timing-order.test.ts` (pattern: `tests/features/sync/__tests__/background-sync-bounded-awaits.test.ts`'s seven-constant chain test, read-only): one pure-comparison test asserting `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE * SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS + BRIDGE_REQUEST_TIMEOUT_MS < BACKGROUND_SYNC_CYCLE_DEADLINE_MS`, importing the real constants (`19_000 < 45_000`).

### Phase 8: Sync Diagnostics Flush — Capture & Disposition Algorithm (Decision 4)

- [ ] 8.1 RED `tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts` (fake store + fake client): `captureSyncDiagnosticsEnvelope` enqueues only under the same conditions that already gate building the envelope (telemetry preference on AND `resolveClientTelemetry` returned non-null); no capture when the preference is disabled or no telemetry context is supplied.
- [ ] 8.2 RED (same suite): a `2xx` response removes the row and continues to the next candidate; a thrown request leaves the row and stops the batch.
- [ ] 8.3 RED (same suite — BINDING per the orchestrator's amendment to Decision 4): a `404` response leaves the row queued AND stops the batch. The bridge endpoint is not built yet; a blanket 4xx-deletes rule would drain the queue silently during the dual-write window, reproducing the exact invisible-loss failure this change exists to close.
- [ ] 8.4 RED (same suite): a `400` response removes the row and continues — the response names the offending field, so the bridge will reject the same bytes identically forever.
- [ ] 8.5 RED (same suite): `413` and `422` also remove-and-continue (same envelope-malformed family as `400`); `408`, `429`, and every `5xx` leave the row and stop the batch, calling `deferUntil(now + retryAfterMs)` when a `retryAfterMs` is present.
- [ ] 8.6 RED (same suite): a shut gate (`readFlushCandidates` returns `[]`) issues zero POSTs.
- [ ] 8.7 GREEN `src/features/sync/sync-diagnostics-flush.types.ts`: flush params and result types.
- [ ] 8.8 GREEN `src/features/sync/sync-diagnostics-flush.helpers.ts`: `captureSyncDiagnosticsEnvelope` (synchronous, swallows by contract) and `flushSyncDiagnosticsOutbox` (never rejects; oldest-first; batch size `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE`; the disposition taxonomy is a fresh per-envelope rule — it MUST NOT reuse `isPermanentReconcileError`'s (`src/features/sync/reconcile.helpers.ts:62-64`, read-only) blanket `>= 400 && < 500`; governing principle: drop only what is wrong with THIS envelope, preserve anything wrong with the link or endpoint).
- [ ] 8.9 MUTATE (guard cycle #3 — poison-pill): delete the `remove()` call on the `400/413/422` branch; run only the "400 removes and continues" test and confirm RED; restore.
- [ ] 8.10 MUTATE (guard cycle #4): delete the stop/`break` after a transient failure (`404`/`408`/`429`/`5xx`/throw); run only the stop-at-first-failure test and confirm RED (exactly one POST on a dead link); restore.

### Phase 9: Wiring Into `performSyncPendingOperations` (Decision 5)

- [ ] 9.1 RED `tests/features/sync/reconcile.helpers.test.ts`: a throwing `bridgeClient.reconcile` still leaves a durable `sync_diagnostics_outbox` row afterward — the change's headline inversion.
- [ ] 9.2 RED (same suite): a throwing/rejecting flush never reaches `revertPendingOperationsOnFailure` — the flush's own failure must not be misread as a reconcile failure.
- [ ] 9.3 GREEN `src/features/sync/reconcile.helpers.ts`: place `captureSyncDiagnosticsEnvelope(clientTelemetry)` and `await flushSyncDiagnosticsOutbox({ connection, ... })` immediately after `requestBody` is built (~:368), lexically BEFORE the `try` at `:370`, outside every `withLocalWrite` callback (already enforced for `bridgeClient.*` by the existing `no-restricted-syntax` selector in `eslint.config.mjs`, read-only).
- [ ] 9.4 MUTATE (guard cycle #5): move the capture call inside the `try` (or delete it); run only the "throwing reconcile still leaves a row" test and confirm RED; restore.

### Phase 10: Behaviour Proof

- [ ] 10.1 RED→GREEN `tests/behaviour/sync/diagnostics-outbox-round-trip.behaviour.test.ts` (pattern: `tests/behaviour/sync/outbox-round-trip.behaviour.test.ts`, read-only): real SQLite, real drizzle, real write door, real `bridgeClient` — queue a row under a faked failing bridge on one cycle, drain it on a later cycle under a faked success, via `installFakeBridge`.

### Phase 11: Slice B Verification

- [ ] 11.1 Run `npm test` and record the final suite/test count against the Phase 5.1 baseline plus every new suite from Phases 6-10, all green.
- [ ] 11.2 `npm run validate` (lint + typecheck + test) green across every file touched in Phases 6-10. JSDoc for every newly staged export is written as part of its edit (constraint 12), never a bulk pass.
- [ ] 11.3 Commit Slice B with a conventional commit message (e.g. `feat(sync): durably capture and flush diagnostics envelopes to the bridge`).

## Naming & Structural Constraints (apply throughout)

- Never a bare `outbox` identifier — it already means the `operation_log` pending-write queue (`loadPendingOutboxRecordIds`, `tests/behaviour/sync/outbox-round-trip.behaviour.test.ts`, both read-only references). Every new identifier, table, and filename this change introduces carries `diagnostics`.
- `dharness/role-file-shape` forbids values in a `.helpers.ts` file — every constant (DDL, SQL, cap, batch size, timeouts) lives in its sibling `.constants.ts`, per Phases 4.2 and 7.1.
- 500-line rule applies per file; every file in design.md's File Impact table is estimated well under it (max ~150 lines for the behaviour test).
- No new feature folder is created by this change — `npm run generate:feature` does not apply.
- Threat Matrix: N/A per design.md — no routing/shell/subprocess/VCS boundary. The one arguable row (new outbound egress to an already-paired, already-authenticated bridge) is bounded by the existing 3 s request timeout and 3-row batch, not by a dedicated new RED test.

## Rollback

`git revert` either or both commits independently. Dual-write means the reconcile body carries `client_telemetry` unchanged regardless of whether Slice B has shipped; Slice A's `postSyncDiagnostics` has no production caller until Slice B wires it in, so reverting Slice A alone is safe. Leave `sync_diagnostics_outbox` in place if it already exists on a device — dropping a table in `autoreas-telemetry.db` is riskier than leaving an unread table inert.
