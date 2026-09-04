# Design: Background Sync Bounded Awaits

## Technical Approach

Bound every await at the narrowest seam that can *name* the failure, and order the bounds so an inner bound always fires before the outer one. Four seams, one shared primitive, one deterministic architectural check.

The organising invariant is a single total order over the existing and new timing constants. Every `<` encodes a reason, and one unit test asserts the whole chain (R8 acceptance: "cycle deadline < host limit, enforced in a test").

| # | Constant | Value | Owner | Why it must be below the next one |
|---|---|---|---|---|
| 1 | `SQLITE_BUSY_TIMEOUT_MS` | `5_000` (existing) | `startup.constants.ts:5` | The native busy-wait policy must resolve before any JS deadline, or the deadline pre-empts a legitimate lock wait. |
| 2 | `BRIDGE_REQUEST_TIMEOUT_MS` | `10_000` (new) | `bridge-client.constants.ts` | ~450x the observed `duration_ms` (19–22 ms). A hung POST is reported as a transport failure, not as a cycle failure. |
| 3 | `LOCAL_WRITE_DEADLINE_MS` | `20_000` (new) | `client.constants.ts` | A jammed door is attributed to the write layer, not to the cycle. |
| 4 | `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` | `45_000` (new) | `background-sync.constants.ts` | **Load-bearing:** a stalled cycle must terminate and release the cycle lock *before* its lease expires, or a second owner reclaims an expired lease while the first is still running. |
| 5 | `DEFAULT_SYNC_CYCLE_LOCK_LEASE_MS` | `60_000` (existing) | `sync-cycle-lock.constants.ts:5` | The lease is the backstop for a release that itself fails (`sync-cycle-lock.helpers.ts:86-90`). |
| 6 | `BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS` | `90_000` (new) | `background-sync.constants.ts` | The cycle's own terminal outcome must always win; the host signal only backstops teardown (`runtime.open` / `runtime.close`). |
| 7 | `BACKGROUND_SYNC_HOST_RUNTIME_LIMIT_MS` | `600_000` (new, documents the host) | `background-sync.constants.ts` | R8: signal the host before JobScheduler kills the job at its 10-minute guarantee. |

## Architecture Decisions

### Decision 1 — One shared `withDeadline` primitive in infrastructure

**Choice**: `src/infrastructure/async/deadline.helpers.ts` exporting `withDeadline<T>({ operation, timeoutMs, label })` and `DeadlineExceededError`, consumed by seams 2, 3 and 4.

| Option | Tradeoff | Decision |
|---|---|---|
| `withDeadline` in `src/infrastructure/async/` | One new folder + pure barrel | **Chosen** — a timing bound is a technical concern; feature→infrastructure is the allowed direction |
| Local copy per seam | No new folder | Rejected — three copies of the same unhandled-rejection subtlety |
| `AbortSignal.timeout()` | Zero code | Rejected — see Decision 2 |

**Non-obvious requirement**: the primitive must `clearTimeout` on every path. A leaked timer per call keeps the event loop alive, which in a background job means holding the host runtime open after the work is done. The mutation cycle confirms this guard is load-bearing — two tests fail without it.

**CORRECTED AFTER IMPLEMENTATION (2026-09-04).** This section originally claimed that `Promise.race` leaves the loser's rejection **unhandled**, and that the swallowing `.catch()` was therefore the whole reason to have a shared primitive. **That is false.** `Promise.race` subscribes to every input promise, so a loser rejecting after the race settles already has a handler and never surfaces as an `unhandledRejection`. Deleting the `.catch()` changed no observable behaviour: the test asserting "no unhandled rejection" still passed without it.

The `.catch()` is kept as cheap insurance against a refactor that stops racing, and the shipped code documents it as exactly that. It is recorded here rather than quietly edited because the claim was inherited into two agent hand-offs before a mutation caught it — a design that asserts a mechanism it does not have survives review precisely because it sounds specific.

```ts
const timer = setTimeout(() => rejectDeadline(new DeadlineExceededError(label, timeoutMs)), timeoutMs);
// Racing does NOT cancel `operation`; it only bounds the CALLER's view of it.
const settled = operation();
settled.catch(() => undefined); // defence in depth only -- `race` already handles this promise
try { return await Promise.race([settled, deadlinePromise]); } finally { clearTimeout(timer); }
```

### Decision 2 — `AbortController` + `setTimeout`, not `AbortSignal.timeout()`

**Choice**: `request` builds an `AbortController`, sets `init.signal`, and clears the timer in a `finally`.
**Rationale**: `AbortSignal.timeout()` is a newer static that React Native's polyfilled `AbortController` surface does not reliably ship, and — decisively — Jest fake timers cannot drive its internal timer. Every acceptance in this change must be unit-testable with no device (`resolveFetch()` returns `dependencies.fetchFn ?? globalThis.fetch`, so the wire is already substitutable). A timer we own is a timer a test can advance.

### Decision 3 — Abort surfaces as `BridgeTimeoutError extends BridgeUnreachableError`

**Choice**: a distinct class that **subclasses** the existing error.
**Alternatives considered**: reuse `BridgeUnreachableError` verbatim (no distinct identity); a sibling `Error` subclass (distinct, but silently changes classification).
**Rationale — verified, not assumed**: `BridgeUnreachableError` is consumed by `instanceof` at exactly two sites — `season-rating-queue.helpers.ts:88` (classify as transient / retry) and `sync-connection-store.helpers.ts:58` (`kind: 'unreachable'`). A timeout **is** "did not reach the bridge" and **is** transient, so both sites are already correct for it. Subclassing keeps both behaviours with zero call-site edits, while `name: 'BridgeTimeoutError'` and `instanceof BridgeTimeoutError` give R8 the distinct typed identity. A sibling class would have silently reclassified every timeout as a permanent `sync_error`.

### Decision 4 — Cycle deadline wraps the `run` callback, not the `withExclusiveSyncCycle` call

**Choice**: in `runBackgroundSyncCycle`, the deadline wraps the callback passed to `withExclusiveSyncCycle`, rejecting with `SyncCycleDeadlineError`.
**Rationale**: wrapping the outer call would orphan the lock release. Wrapping `run` makes the rejection propagate *through* `withExclusiveSyncCycle`, whose `finally` still executes `releaseSyncCycleLock` (`sync-cycle-lock.helpers.ts:81-91`). The lock is released properly instead of waiting out its lease.

**What happens to the orphaned in-flight operation, and why it is safe here.** Racing does not cancel. The orphan keeps running on the JS runtime, and there are exactly two cases:
- **A hung POST** — already aborted at 10 s by seam 1, so it cannot reach the 45 s deadline. The deadline only fires when something *else* stalls.
- **Native SQLite work inside a write door** — the door stays closed and the queue entry stays pending. Safe because (a) `withQueuedWrite` chains through `.catch(() => undefined)` (`client.helpers.ts:285,287`), so a late rejection never poisons the chain; (b) the 60 s lease is the designed backstop if `releaseSyncCycleLock` itself cannot complete; (c) `sqlite-sync-runtime.helpers.ts:83-89` deliberately nulls the handle only *after* a proven close, so a connection stuck mid-transaction is never stranded unreferenced.

The orphan can outlive the cycle only until the process ends. That is strictly better than today: today the **job** never terminates, so JobScheduler kills it at 600 s and WorkManager's interruption path re-enqueues with no backoff (H06h). Under this design `doWork` completes normally, so the next run honours `minimumInterval` instead.

### Decision 5 — Host completion signal is a domain outcome, mapped in `.task.ts`

**Choice**: `resolveBackgroundTaskOutcome({ runCycle, timeoutMs })` in `background-sync.helpers.ts` returns `'success' | 'failed'`; `background-sync.task.ts` maps it onto `BackgroundTask.BackgroundTaskResult`.
**Rationale**: this is the half that actually breaks H06h's loop — `BackgroundTaskScheduler.kt:230-247` awaits a `CompletableDeferred` that an un-signalled JS task never completes, and `tasks.awaitAll()` then suspends until the host kills the job. Keeping the guard out of `.task.ts` and free of the Expo enum makes it unit-testable with fake timers; `.task.ts` keeps only the enum mapping and its `try/catch` re-evaluation guard. The guard wraps the **whole** `runBackgroundSyncCycle()` call, so a hang in `runtime.open()` or in the `finally { runtime.close() }` still settles.

### Decision 6 — Write door: the deadline rejects the CALLER; the door STAYS CLOSED

**This seam is different in kind and must not be built as another timer race.** A JS timer cannot cancel native SQLite work. If a deadline *opened* the door, a successor would issue `BEGIN IMMEDIATE` on a connection that already has an open transaction — the `SQLITE_BUSY_SNAPSHOT` class that the file-keyed door exists to prevent (`client.constants.ts:14-19`, archived `2026-08-12-sqlite-write-lock-contention`). A visible deadlock beats two concurrent transactions.

The mechanism is three lines: the queue keeps chaining on the **real** write; only the caller's view is bounded.

```ts
const nextWrite = previousWrite.catch(() => undefined).then(runWrite);
// The door opens only when the underlying transaction actually settles.
// A deadline NEVER admits a successor -- the queue chains on `nextWrite`, never on the raced promise.
WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite.catch(() => undefined));
return withDeadline({ operation: () => nextWrite, timeoutMs: LOCAL_WRITE_DEADLINE_MS, label: 'local_write' })
  .catch((error) => { throw error instanceof DeadlineExceededError ? toLocalWriteError(error, startedAt, 'deadline') : error; });
```

`LocalWriteFailureStage` gains `'deadline'` (currently `'begin' | 'task' | 'commit' | 'rollback'`, `client.types.ts:7`). Rethrowing as `LocalWriteError` keeps the shape-based `readLocalWriteFailureDiagnostics` (`anime-mutation-failure.helpers.ts:57-62`) working, so a jammed door reaches the Settings tile with `errcode`/`elapsedMs`/`stage`. `startedAt` is taken in `withQueuedWrite`, so `elapsedMs` **includes queue-wait time** — deliberate: a caller stuck behind a jammed door is exactly what must be visible.

### Decision 7 — The primary defence is architectural, enforced by a lint selector

**Choice**: a new `no-restricted-syntax` block in `eslint.config.mjs`, sibling to the Write Door selector at `:48-56`, forbidding network calls lexically inside a `withLocalWrite` callback.

```js
files: ['src/**/*.ts', 'src/**/*.tsx'],
selector:
  "CallExpression[callee.name='withLocalWrite'] :matches(" +
    "CallExpression[callee.object.name='bridgeClient']," +
    "CallExpression[callee.name='fetch']," +
    "NewExpression[callee.name='WebSocket'])",
```

The invariant holds today and is verified, not assumed: `bridgeClient.reconcile` sits at `reconcile.helpers.ts:313`, strictly *between* the doors at `:296`, `:361` and `:410`.

**Stated limitation, not overclaimed**: the selector is lexical. It catches a network call written syntactically inside the callback; it cannot follow a locally-defined function that itself does network I/O. That is the same convention-bound floor the existing `tx` exemption carries (`eslint.config.mjs:43-45`). It is a floor, not a proof — which is why the door deadline (Decision 6) exists behind it.

## Data Flow

```
defineTask callback ──[TASK_SIGNAL_DEADLINE 90s]────────────────────────┐
  └─ runBackgroundSyncCycle()                                           │
       ├─ runtime.open()                                                │
       ├─ withExclusiveSyncCycle(claim ─→ run ─→ release)               │
       │     └─ run ──[CYCLE_DEADLINE 45s → SyncCycleDeadlineError]     │
       │          └─ runHeadlessSyncCycle → syncPendingOperations       │
       │               ├─ withLocalWrite  :296 ─[WRITE 20s → caller]    │
       │               ├─ bridgeClient.reconcile :313 ─[REQ 10s → abort]│
       │               ├─ withLocalWrite  :361 ─[WRITE 20s → caller]    │
       │               └─ withLocalWrite  :410 ─[WRITE 20s → caller]    │
       └─ finally runtime.close()                                       │
                                                                        ▼
                                     BackgroundTaskResult (Success|Failed) — ALWAYS
```

## File Changes

| File | Action | Description | ~lines |
|---|---|---|---|
| `src/infrastructure/async/deadline.helpers.ts` | Create | `withDeadline`, `DeadlineExceededError` | 50 |
| `src/infrastructure/async/index.ts` | Create | Pure re-export barrel | 5 |
| `src/infrastructure/api/bridge-client/bridge-client.constants.ts` | Modify | `BRIDGE_REQUEST_TIMEOUT_MS` | 6 |
| `src/infrastructure/api/bridge-client/bridge-client.types.ts` | Modify | Optional `timeoutMs` on `BridgeRequestSpec` | 4 |
| `src/infrastructure/api/bridge-client/bridge-client.helpers.ts` | Modify | `BridgeTimeoutError`; `AbortController` + `init.signal`; `clearTimeout` on every path | 40 |
| `src/infrastructure/api/bridge-client/index.ts`, `src/infrastructure/api/index.ts` | Modify | Export `BridgeTimeoutError` | 4 |
| `src/infrastructure/db/client/client.constants.ts` | Modify | `LOCAL_WRITE_DEADLINE_MS` | 8 |
| `src/infrastructure/db/client/client.types.ts` | Modify | `LocalWriteFailureStage` += `'deadline'` | 2 |
| `src/infrastructure/db/client/client.helpers.ts` | Modify | Door deadline in `withQueuedWrite` (Decision 6) | 20 |
| `src/features/sync/background-sync.constants.ts` | Modify | `minimumInterval: 15`; three deadline constants + rationale JSDoc | 24 |
| `src/features/sync/background-sync.errors.ts` | Create | `SyncCycleDeadlineError` (`.errors.ts` follows `startup.errors.ts`) | 18 |
| `src/features/sync/background-sync.helpers.ts` | Modify | Cycle deadline around `run`; `resolveBackgroundTaskOutcome` | 50 |
| `src/features/sync/background-sync.task.ts` | Modify | Map domain outcome → `BackgroundTaskResult` | 14 |
| `eslint.config.mjs` | Modify | Unbounded-I/O-in-door selector | 24 |
| **`src/` subtotal** | | | **~269** |
| `tests/infrastructure/async/__tests__/deadline.helpers.test.ts` | Create | Primitive: resolve, reject, timer cleared, no `unhandledRejection` | 80 |
| `tests/infrastructure/api/bridge-client.helpers.test.ts` | Modify | Seam 1 | 70 |
| `tests/infrastructure/db/client/client.helpers.test.ts` | Modify | Seam 4 door semantics | 70 |
| `tests/features/sync/__tests__/background-sync-bounded-awaits.test.ts` | Create | Seams 2 + 3 + the timing-order chain + T4 | 110 |
| `tests/features/sync/background-sync.task.test.ts` | Modify | Callback always settles | 45 |
| `tests/infrastructure/__tests__/write-door-lint-boundary.test.ts` | Create | Decision 7 selector fires / stays silent | 50 |
| **`tests/` subtotal** | | | **~425** |
| **Total** | | | **~694** |

New tests go under `__tests__/` per CLAUDE.md constraint 3; existing flat files in `tests/features/sync/` are pre-existing drift and are edited in place, not moved.

## Interfaces / Contracts

```ts
// src/infrastructure/async/deadline.helpers.ts
export class DeadlineExceededError extends Error {
  readonly label: string;
  readonly timeoutMs: number;
}
export function withDeadline<T>(params: {
  readonly operation: () => Promise<T>;
  readonly timeoutMs: number;
  readonly label: string;
}): Promise<T>;

// src/infrastructure/api/bridge-client/bridge-client.types.ts
export interface BridgeRequestSpec {
  readonly method: BridgeHttpMethod;
  readonly path: string;
  readonly token?: string;
  readonly body?: unknown;
  readonly timeoutMs?: number; // defaults to BRIDGE_REQUEST_TIMEOUT_MS
}

// src/infrastructure/api/bridge-client/bridge-client.helpers.ts
export class BridgeTimeoutError extends BridgeUnreachableError {
  readonly timeoutMs: number; // name = 'BridgeTimeoutError'
}

// src/features/sync/background-sync.helpers.ts
export type BackgroundTaskOutcome = 'success' | 'failed';
export function resolveBackgroundTaskOutcome(params: {
  readonly runCycle: () => Promise<unknown>;
  readonly timeoutMs?: number;
}): Promise<BackgroundTaskOutcome>;
```

## Testing Strategy

All unit, all fake timers (`jest.useFakeTimers()` + `await jest.advanceTimersByTimeAsync(ms)` so microtasks flush between ticks). No device, no `adb`.

| Seam | Test | Approach |
|---|---|---|
| Primitive | resolves before deadline; rejects `DeadlineExceededError` after; `jest.getTimerCount() === 0` on both paths; a late operation rejection raises no `unhandledRejection` (an end-to-end property, provided by `race` rather than by the `.catch()` -- see the correction above) | inject a never-settling and a late-rejecting `operation`; register a `process.on('unhandledRejection')` probe |
| 1 Request | a `fetchFn` that never settles rejects `BridgeTimeoutError` at `BRIDGE_REQUEST_TIMEOUT_MS`; `init.signal.aborted === true`; `spec.timeoutMs` overrides; timer count is 0 after success, HTTP 500, **and** network throw | substitute `dependencies.fetchFn`; capture `init` from the mock's first arg |
| 1 Classification | `BridgeTimeoutError instanceof BridgeUnreachableError === true` | direct assertion — pins the two `instanceof` consumers |
| 2 Cycle | a `run` that never settles → `runBackgroundSyncCycle` rejects `SyncCycleDeadlineError` at 45 s **and** `releaseSyncCycleLock` still ran | mock `withExclusiveSyncCycle` collaborators; assert the release write was issued |
| 2 Order | the full seven-constant chain asserted in one test | pure constant comparison; imports the real constants |
| 3 Host | `resolveBackgroundTaskOutcome` with a never-settling `runCycle` resolves `'failed'` at 90 s; a throwing `runCycle` resolves `'failed'`; a normal one resolves `'success'` | fake timers |
| 3 Task | the `defineTask` callback settles with a `BackgroundTaskResult` when the cycle hangs | existing `background-sync.task.test.ts` harness |
| 4 Caller | a never-settling `runWrite` rejects the caller with `LocalWriteError` + `stage: 'deadline'` at 20 s; `elapsedMs` includes queue wait | inject a pending task into `withLocalWrite` |
| 4 **Door closed** | after the first caller's deadline fires, a second `withLocalWrite` on the same file **has not** started — it starts only once the first write actually settles | two `withLocalWrite` calls, same `databasePath`; assert `BEGIN IMMEDIATE` was issued exactly once |
| 4 Interval | `BACKGROUND_SYNC_TASK_OPTIONS.minimumInterval === 15` (T4) | constant assertion |
| 7 Lint | the selector reports exactly 1 error on a violating snippet and 0 on a compliant one | `new Linter({ configType: 'flat' })` over an inline source string. **Fallback if `eslint` will not load under `jest-expo`**: import `eslint.config.mjs` and assert the rule entry and its selector string are present — weaker, still deterministic and still mutation-sensitive |

### Mutation cycle (constraint 9 — stage first, then mutate)

Applies to every guard below. `git add` while green → delete the guard → run only that test → confirm RED → `git checkout -- <file>`. Never `git add` after mutating; never `git checkout HEAD --` while the feature is uncommitted.

| # | Guard to delete | Test that must go RED |
|---|---|---|
| 1 | `clearTimeout` in `request`'s `finally` | timer-count-is-0 on all three paths |
| 2 | `init.signal = controller.signal` | abort test |
| 3 | `.catch(() => undefined)` on the losing operation in `withDeadline` | `unhandledRejection` probe |
| 4 | **`WRITE_QUEUE_BY_DATABASE.set(queueKey, nextWrite…)` → set to the raced promise** | **"door closed" test** — the single most important mutation in this change; it is the exact regression the proposal names |
| 5 | the `withDeadline` wrapper around `run` in `runBackgroundSyncCycle` | cycle-hang test |
| 6 | the deadline branch in `resolveBackgroundTaskOutcome` | host-signal test |
| 7 | the `no-restricted-syntax` selector entry | lint-boundary test |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, or executable-file classification boundary.` The one arguable row is **process integration**: the change alters what the `expo-background-task` host callback returns. It spawns nothing, executes nothing, and classifies no file; its entire surface is a return value on a callback the host already invokes. That boundary is covered by the timing-order test (constant 6 < constant 7) and the "callback always settles" test rather than by a threat-matrix task.

## Migration / Rollout

No migration required. Every edit is additive or single-token: an optional interface field, an error subclass, four constants, a wrapper, a lint selector, and `15 * 60 → 15`. No schema change, no persisted state, no feature flag. Rollback is `git revert` of the commit.

**Review budget forecast**: ~694 authored lines. `400-line budget risk: High` against the default 400-line guard, `Low` against this change's granted 800. If chained slices are chosen, split on the seam boundary:
- **Slice A** (~305) — `src/infrastructure/async/**`, bridge-client files, their tests. Self-contained: seam 1 plus the primitive.
- **Slice B** (~389) — sync files, db client files, `eslint.config.mjs`, their tests. Depends on A for `withDeadline`.

## Open Questions

- [ ] None blocking. Two apply-time verifications: (1) confirm no exhaustive `switch` over `LocalWriteFailureStage` exists before adding `'deadline'`; (2) if `eslint`'s `Linter` will not load under the `jest-expo` transform, take the named fallback assertion for the lint-boundary test rather than dropping the guard.
- [ ] Every file staged in this change inherits its standing `dharness/require-jsdoc` and `require-variable-jsdoc` debt (constraint 12). JSDoc is written as part of each edit, not as a separate pass, and is included in the line estimates above.
