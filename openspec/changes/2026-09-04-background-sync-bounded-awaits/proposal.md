# Proposal: Background Sync Bounded Awaits

## Intent

**Nothing in a reconcile cycle is bounded (R8).** `request` builds `init` with only `method`/`headers` and awaits `resolveFetch()(url, init)` with no `AbortSignal` on any path (`bridge-client.helpers.ts:64-75`); `BridgeRequestSpec` carries no timeout field (`bridge-client.types.ts:42-47`).

Per H06h the consequence is not a slow cycle but a **permanently suspended host job**: `expo-background-task` awaits a `CompletableDeferred` an un-signalled JS task never completes (`BackgroundTaskScheduler.kt:230-247`); JobScheduler kills it at ~10 min and re-enqueues with no backoff — matching the measured 601.9 s bridge cadence with zero cursor advances.

The write door inherits this. A rejected write already cannot stall the queue — `client.helpers.ts:285-287` swallows rejection twice. Only a write that **never settles** jams the door, and every later write to that file behind it.

**The WorkManager floor is 15 hours (D8).** `minimumInterval: 15 * 60` (`background-sync.constants.ts:7`) is read as minutes.

Both are source-verified defects, correct under every hypothesis outcome.

## Scope

### In Scope

- `AbortSignal` timeout on every `BridgeClient` request; per-spec override, safe default, typed abort failure.
- A cycle deadline shorter than the host job's runtime limit; on expiry the cycle terminates with a typed failure.
- Host-signal guarantee: the `defineTask` callback always settles with a `BackgroundTaskResult`, even when the cycle hangs.
- Write door: a deterministic check keeping unbounded I/O out of the door, plus a door deadline that rejects the caller with a typed failure **without opening the door**.
- `minimumInterval: 15`.

### Out of Scope

- `SyncTrace` (MB-0b); durable 202 transaction (MB-0c).
- Any new native module, foreground-service or WebSocket change.
- Any acceptance criterion requiring a device or `adb`.

## Capabilities

### New Capabilities
- `background-sync-delivery`: bounded reconcile cycle — request timeout, cycle deadline, host completion signal, scheduler interval unit.

### Modified Capabilities
- `local-write-serialization`: no unbounded await inside a write door; a stalled door fails loudly instead of admitting a second writer.

## Approach

Bound each layer at its own seam. Timeout lives in `src/infrastructure/api/**` (Bridge Boundary intact). The cycle races work against a deadline; the task callback returns a terminal result on either branch.

**The write door is different in kind and must not be treated as another timer.** A JS timer cannot cancel native SQLite work, so its primary defence is architectural: keep unbounded I/O outside the door. That invariant holds today and is verified, not assumed — `bridgeClient.reconcile` sits at `reconcile.helpers.ts:313`, strictly between doors at `:296`, `:361`, `:410`; season-rating delivery sits at `season-rating-queue.helpers.ts:293-297`, between doors at `:289`, `:300`, `:306`. Bounding `BridgeClient` is what keeps it that way. A deterministic check — sibling to the Write Door selector at `eslint.config.mjs:48-56` — stops a future unbounded await from moving inside.

What remains inside the door is native SQLite work. Its deadline rejects the caller with a typed failure and makes the stall observable; it **never opens the door**. `withLocalWrite` issues `BEGIN IMMEDIATE` on the same `rawDb`, so admitting a successor means a second transaction against a connection that already has one open — the `SQLITE_BUSY_SNAPSHOT` class the file-keyed door exists to prevent (`client.constants.ts:14-19`, archived `2026-08-12-sqlite-write-lock-contention`). A visible deadlock beats two concurrent transactions.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `bridge-client.types.ts` | Modified | Optional `timeoutMs` on `BridgeRequestSpec` |
| `bridge-client.helpers.ts` | Modified | `AbortSignal` timeout, typed abort failure |
| `db/client/client.helpers.ts` | Modified | Door deadline; typed failure; door stays closed |
| `eslint.config.mjs` | Modified | Selector: no bridge/network call inside a `withLocalWrite` callback |
| `sync/background-sync.constants.ts` | Modified | `minimumInterval: 15`; deadline constant |
| `sync/background-sync.helpers.ts`, `.task.ts` | Modified | Cycle deadline; always signal host |
| `tests/features/sync/`, `tests/infrastructure/` | New | Fake-timer suites per guard |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Implemented as a timeout only — looks fixed, still hangs | Medium | Settle guarantee and host-signal path ship in THIS change; acceptance is terminal outcome, not timeout existence |
| **Door deadline implemented as door-opening**, reintroducing lock contention | Medium | Corrected at proposal review. The door stays closed; the deadline rejects the caller only. Do not restore "the next queued write still runs" — it is the wrong goal |
| Default timeout too aggressive on a slow LAN | Low | Per-spec override; default far above observed `duration_ms` (~19-22 ms) |
| Guards pass with the guard deleted | Medium | Constraint 9 stage-first mutation cycle on every new guard |
| Staged files inherit `dharness` JSDoc debt | High | Write JSDoc as part of each edit (constraint 12) |

## Rollback Plan

Revert the commit. All edits are additive or single-token: an optional field, a wrapper, a lint selector, one constant. No schema change, no migration, no persisted state.

## Dependencies

None. Buildable with `(device)` evidence empty (plan §10.2).

## Success Criteria

- [ ] Every started cycle reaches a terminal outcome — no path exists where a cycle neither completes nor fails.
- [ ] Cycle deadline is asserted < host runtime limit in a test.
- [ ] A hung `fetch` aborts and surfaces a typed transport failure.
- [ ] Every `withLocalWrite` caller receives a settled promise: its result, or a typed timeout failure.
- [ ] No code path can place an unbounded await inside a write door; a deterministic check flags it.
- [ ] A door deadline never admits a second concurrent write to the same file.
- [ ] The task callback returns a `BackgroundTaskResult` when the cycle hangs.
- [ ] `BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval === 15` (T4).
- [ ] Regression floor holds: 109 suites, 654 tests green.
