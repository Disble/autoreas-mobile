# Design: SQLite write-lock contention kills chapter mutations

## Technical Approach

One write door per database **file**, holding a write lock acquired through the **async** API before any synchronous drizzle statement runs. Connection policy moves to open time so no connection can skip `busy_timeout`. Close becomes success-gated so a stuck connection stays reachable. Six slices (A–F) from the proposal, each ≤150 authored lines.

## Drift Register (verified on disk, contradicts inputs)

| Finding | Evidence | Impact |
|---|---|---|
| The Bridge Boundary `no-restricted-syntax` rule **no longer exists**. `eslint.config.mjs` is now `dlinter-ts-react@0.9.0` `createRecommendedConfig`. Its `infrastructure` edge governs *import specifiers and runtime globals*, not method calls (`dist/index.d.mts:1111-1120`), so it cannot express the write door. | `eslint.config.mjs:1-28` | Slice F appends its own block. `no-restricted-syntax` appears nowhere in dlinter's `dist`, so appending does not clobber. `CLAUDE.md` constraint 8 is stale and must be corrected. |
| **errcode `517` is not observable through expo-sqlite.** Expo never calls `exsqlite3_extended_result_codes`, so `exsqlite3_errcode` returns the *primary* code (5) for both `SQLITE_BUSY` and `SQLITE_BUSY_SNAPSHOT`. Worse, `NativeDatabaseBinding.cpp:197-198` does `std::string result("Error code "); result += code;` — `int`→`char`, so the code is appended as an invisible control byte. That is literally why the toast reads `Error code : database is locked`. Every failure arrives as `CodedException("ERR_INTERNAL_SQLITE_ERROR", …)` (`SQLExceptions.kt:21-22`); the JS `code` is that constant string, never a number. | `NativeDatabaseBinding.cpp:194-202`, `SQLExceptions.kt:21-22` | Slice A cannot ship the proposal's `5` vs `517` split. It ships the discriminators that **are** observable: primary errcode, `elapsedMs`, and failure `stage`. |

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| 1 | Write-door key | `Map<string, Promise<unknown>>` keyed by `rawDb.databasePath` (readonly on `SQLiteDatabase`), falling back to `DATABASE_NAME` | `WeakMap` on `rawDb as object`; a bare module-level promise | Path unifies every connection to one file; the current key gives per-*connection* ordering, which H10 showed is no ordering at all |
| 2 | Public surface | `src/infrastructure/db/client/index.ts` exports exactly one door, `withLocalWrite(rawDb, task)`. Feature code may call only this | Keeping two doors; a full persistence facade | Two doors is how the bypass happened. A facade over reads is explicitly out of scope |
| 3 | Isolation | `execAsync('BEGIN IMMEDIATE')` awaited **before** the callback | `rawDb.withTransactionAsync` (hardcodes deferred `BEGIN`, `SQLiteDatabase.js:122`); a watchdog | The busy wait must land on expo's native thread. Drizzle's driver is `executeSync`; a lock taken synchronously freezes JS ~5.5s (H2). H11 invalidated the watchdog |
| 4 | `withExclusiveWrite` | **Deleted** | Reimplement on the shared connection | It opens a zero-pragma connection per call (H2: 0.10ms vs 5534ms) and queues on connection A while writing on connection B. `reconcile.helpers.ts:362` selects it by `applyMode`, but the reactive concern at `:203-213` is *which table* is written, and that branch already lives **inside** the callback at `:365`. Non-reactivity comes from the caller's `enableChangeListener: false` connection, never from this helper — so collapsing to one door preserves the behaviour exactly |
| 5 | Open-time policy | `openAppDatabaseSync` issues `PRAGMA busy_timeout` via `execSync` before returning the handle; `prepare{Foreground,Headless}Database` keep it (idempotent) | Convention only | Three open paths exist: `SQLiteProvider onInit`, `openAppDatabaseSync`, and the implicit exclusive-transaction connection. Decision 4 removes the third; a pragma at open closes the second structurally. `busy_timeout` is connection-local and takes no lock, so `execSync` is safe |
| 6 | Close | Null the handle **only after** a proven close | `finally { rawDb = null }` | H6: a successful close releases the lock. Dropping an unclosed handle is what made the failure permanent |
| 7 | Diagnostics | `LocalWriteError` carrying `{ errcode, elapsedMs, stage }`, with `message` copied verbatim from the cause | Mutating the thrown error; a new toast field | `elapsedMs` is the discriminator `517` was meant to be: H1 failed in 0.07ms (handler never ran → snapshot upgrade), H2 in 5534ms (handler exhausted → real lock held). Verbatim `message` keeps the toast contract byte-identical |
| 8 | Lint | Append a block after `createRecommendedConfig`, restricting `runAsync\|runSync\|execAsync\|execSync` and both `with*TransactionAsync` on `src/features/**`, exempting `callee.object.name === 'tx'` | Flow analysis; moving raw SQL into infrastructure | ESLint cannot tell `tx` from `rawDb`, so the door's transaction handle is fixed by convention as `tx`. Reads (`getAllAsync`/`getFirstAsync`) stay allowed |

## Interfaces

```ts
// src/infrastructure/db/client — the only write door
export async function withLocalWrite<T>(
  rawDb: SQLiteDatabase,
  task: (db: AppDatabase, tx: SQLiteDatabase) => Promise<T>,
): Promise<T>;

export interface LocalWriteFailureDiagnostics {
  readonly errcode: number | null;   // PRIMARY code, low byte only — 517 is unrecoverable
  readonly elapsedMs: number;        // <500ms = busy handler never ran; ~5000ms = handler lost
  readonly stage: 'begin' | 'task' | 'commit' | 'rollback';
}
```

Statement order — `BEGIN` sits **outside** the rollback guard, because expo's own helper rolls back a transaction that never began and masks the real error:

```ts
const startedAt = Date.now();
await rawDb.execAsync('BEGIN IMMEDIATE');   // stage 'begin'; failure => no ROLLBACK
try {
  const result = await task(createDrizzleDb(rawDb), rawDb);
  await rawDb.execAsync('COMMIT');
  return result;
} catch (error) {
  try { await rawDb.execAsync('ROLLBACK'); } catch { /* never mask the original */ }
  throw toLocalWriteError(error, startedAt);
}
```

## Data Flow

```
UI tap ─┐
        ├─→ withLocalWrite ─→ [queue by databasePath] ─→ BEGIN IMMEDIATE (async)
sync ───┘                                                      │
                                                    drizzle executeSync (lock held)
                                                               │
                                                        COMMIT / ROLLBACK
```

A JS queue cannot span two JS runtimes (headless/FGS), so C and E stay the SQLite-level backstop. D alone is never sufficient.

**Regression guard — the door wraps a *transaction*, never a region that itself opens doors.** Two consequences. `drainSeasonRatingQueue` keeps its bridge round-trips **between** doors; wrapping its loop would park a UI tap behind network I/O. And `withExclusiveSyncCycle` is never wrapped as a whole — its inner doors would wait on an outer door that is waiting on `run()`, a self-deadlock.

**Cycle-lock routing (the seventh and eighth doors).** `claimSyncCycleLock:22` and `releaseSyncCycleLock:39` are routed, not exempted. They are not ordinary writes: they are the primitive that serialises cycles across connections *and across JS runtimes*, which is exactly where the JS queue cannot reach. Unrouted, a contended claim throws — `claimSyncCycleLock` reports acquisition as `result.changes === 1`, so `SQLITE_BUSY` does not degrade to "not acquired", it propagates out of `withExclusiveSyncCycle` and kills the cycle. Routed, `BEGIN IMMEDIATE` + `busy_timeout` make it wait instead. Nesting is safe: `claimSyncCycleLock` is fully awaited and its door commits and closes **before** `run()` is invoked, and the `finally` release opens a fresh door after `run()` has settled — sequential, never nested. A failed release degrades to lease expiry, the path the `:46-52` docstring already designs for; but the release is additionally wrapped so a failure cannot replace `run()`'s error, the same masking rule as decisions 2 and 6.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/infrastructure/db/client/client.constants.ts` | Modify | `WRITE_QUEUE_BY_DATABASE` → `Map<string, …>` keyed by path (D) |
| `src/infrastructure/db/client/client.helpers.ts` | Modify | File key + `BEGIN IMMEDIATE`; delete `withExclusiveWrite`; `busy_timeout` at open (C/D/E) |
| `src/infrastructure/db/client/index.ts` | Modify | Export `withLocalWrite`; drop `withExclusiveWrite` (E) |
| `src/infrastructure/db/client/client.types.ts` | Modify | `LocalWriteFailureDiagnostics` (A) |
| `src/infrastructure/db/startup/startup.helpers.ts` | Modify | Shared `applyConnectionPolicy` (C) |
| `src/features/sync/sqlite-sync-runtime.helpers.ts` | Modify | Null handle only after a proven close (B) |
| `.../notifee-foreground-service-adapter.helpers.ts` | Modify | `closeServiceRuntime` never throws, keeps the handle on failure (B) |
| `src/features/sync/{season-rating-queue,operation-log-retention,season-sync}.helpers.ts` | Modify | Route six of the eight writes through the door; rename raw params to `tx` (D) |
| `src/features/sync/sync-cycle-lock.helpers.ts` | Modify | Route the remaining two — `claimSyncCycleLock:22`, `releaseSyncCycleLock:39` — plus guard the release against masking `run()`'s error (D) |
| `src/features/sync/reconcile.helpers.ts` | Modify | 3 calls → `withLocalWrite`; collapse the `:362` selector (E) |
| `src/features/sync/initial-sync.helpers.ts` | Modify | `:66` type reference only — retarget off `withExclusiveWrite` (E) |
| `src/features/animes/anime-mutation-failure.helpers.ts` | Modify | Read diagnostics; toast copy unchanged (A) |
| `eslint.config.mjs`, `ARCHITECTURE.md`, `CLAUDE.md` | Modify | Write-door rule; correct the stale Bridge Boundary claim (F) |
| `tests/infrastructure/db/write-queue.test.ts` | Modify | Delete tests 1–2 (watchdog, H11-invalidated); test 3 stays and needs `databasePath` on both mocks to be meaningful |

## Testing Strategy

`jest-expo` mocks `expo-sqlite`: **no Jest test can observe a lock, a pragma, or transaction semantics.** That is the gap that let this ship. Jest asserts call shape; `tests/sqlite-lab/` asserts behaviour.

| Slice | Jest (mocked, `tests/…/__tests__/`) | sqlite-lab (real SQLite) |
|---|---|---|
| A | Control byte → `5`; unparseable → `null`; toast copy byte-identical to today | h13: measure the `5`/`517` + elapsed split `node:sqlite` exposes and expo destroys |
| B | `close()` rejects → `isOpen()` still true, same handle; `closeServiceRuntime` never throws | h14: failed close, retry, lock released (extends H6) |
| C | Pragma issued on every open path | h2 arm: policy-opened connection waits ~5000ms, not 0.10ms |
| D | Two `rawDb` objects, one `databasePath` → serialized (existing test 3, currently RED); all **eight** sites route through the door; a claim/release pair nests no doors; a throwing release does not replace `run()`'s error | h9 re-run 0/1000; h10 with the bypasser closed stays 0/1000; contended `claimSyncCycleLock` waits and acquires instead of throwing |
| E | Order `BEGIN IMMEDIATE`→task→`COMMIT`; task throws → one `ROLLBACK`; **`BEGIN` throws → no `ROLLBACK`**; failing rollback does not mask the cause | h3 arm succeeds after waiting; h11 arm never reports "transaction within a transaction" |
| F | — | `npx eslint` on a fixture calling `rawDb.runAsync` under `src/features/**` must fail, **and `npx eslint src/features` must pass clean** — F is only landable once D has routed all eight sites, otherwise the rule breaks the build on the real tree |

Mutation mandate (constraint 9) applies to every helper above: delete the guard, confirm RED, `git checkout HEAD -- <file>`.

## Slice Forecast

Routing the two cycle-lock doors adds ~55 authored lines to D (wrapping, the release guard, and its Jest arms), pushing it from ~150 to ~205. D therefore splits, as E already did:

| Slice | Scope | Authored |
|---|---|---|
| A | errcode telemetry | ~120 |
| B | leak fixes | ~60 |
| C | open-time policy | ~80 |
| D1 | file-keyed serializer | ~70 |
| D2 | route all eight doors + param renames | ~135 |
| E1 | `BEGIN IMMEDIATE`, delete `withExclusiveWrite`, reconcile sites | ~125 |
| E2 | mechanical `withDeferredWrite` → `withLocalWrite` rename | ~32 |
| F | write-door rule + docs | ~70 |

Eight slices, ~692 lines — inside the proposal's ~550–700 forecast. `400-line budget risk: High`. `Chained PRs recommended: Yes`. `Decision needed before apply: No` (auto-chain cached).

D1 is safe to land alone: a file-keyed queue with bypassers still open is strictly better than today's per-connection queue with the same bypassers, so it introduces no regression. It is simply not sufficient until D2, which is why both precede F.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. This is a persistence-layer concurrency change.

## Migration / Rollout

No data migration. WAL is a persistent file-header setting already applied. Each slice is one revertable commit; reverting E→D→C restores current behaviour, A and B are additive.

## Open Questions

- [ ] Which production connection leaks the transaction — slice A's `stage: 'begin'` + `elapsedMs` is the instrument, needs a field build.
- [ ] iOS `convertSqlLiteErrorToString` was not read; the errcode parser must degrade to `null` rather than assume the Android byte format.
