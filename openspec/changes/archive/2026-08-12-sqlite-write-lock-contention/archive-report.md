# Archive Report — sqlite-write-lock-contention

Closed: 2026-08-12
Status: **applied, verified, merged**

## What this change fixed

The anime chapter `+`/`-` buttons intermittently stopped working, showing `Call to function 'NativeStatement.runSync' has been rejected. -> Caused by: Error code : database is locked`, and stayed broken until the app was force-closed.

The root cause had **two independent parts**:

1. **The failure.** Writes ran a plain deferred `BEGIN`, then read, then wrote. In WAL, that write-lock upgrade returns `SQLITE_BUSY_SNAPSHOT` *immediately, without invoking the busy handler*, so `PRAGMA busy_timeout = 5000` was inert on the failing path. It was amplified because `withExclusiveTransactionAsync` opened a brand-new connection per call that received no pragma at all — three of six write-capable connections ran with `busy_timeout = 0`.
2. **The permanence.** `createSyncSQLiteRuntime.close()` nulled its handle *before* attempting the close, so a rejecting close stranded a still-open connection holding the write lock until process death. That is why only a restart recovered it.

## Method

Twelve falsifiable hypotheses were adjudicated against real SQLite **before any fix was written** — 11 CONFIRMED, 1 FALSIFIED. The harness (`tests/sqlite-lab/`, plain Node + `node:sqlite` + real `worker_threads`, run with `npm run sqlite:lab`) reproduced the bug on demand with a dose-response curve: 0% / 11% / 41.5% / 100% failures by contention level, every failure on the `UPDATE` stage, 0 read failures in 800 reads.

Hypothesis **H11 invalidated an earlier proposed watchdog design**: abandoning a transaction mid-flight changes the next error to `cannot start a transaction within a transaction`, which contradicts the observed byte-identical error on every tap. It also proved the tap connection unwound cleanly, locating the permanent blocker on a *different* connection.

Two documentation drifts were found and verified during design:
- The Bridge Boundary `no-restricted-syntax` ESLint rule no longer exists (docs still claimed it). Corrected in slice F.
- SQLite errcode `517` is **not observable** through expo-sqlite: `NativeDatabaseBinding.cpp:194-200` appends the `int` code to a `std::string`, converting it to a single unprintable byte — literally why the field toast read `Error code : database is locked` with an apparently empty slot. The design substituted `elapsedMs` as the discriminator, empirically validated by lab arm h13.

## Delivered

Eight slices, one commit each, on `main`:

| Commit | Slice |
|---|---|
| `1aaa455` | A — capture sqlite errcode diagnostics on write failure |
| `f9138b4` | B — keep a connection reachable after a failed close |
| `5180087` | C — apply busy_timeout at connection open time |
| `ce335f5` | D1 — key the write serializer by database file, not connection |
| `7335814` | D2 — route all eight write sites through the file-keyed door |
| `e87c800` | E1 — acquire the write lock upfront, remove the exclusive-transaction door |
| `41fec26` | E2 — rename withDeferredWrite to withLocalWrite |
| `8926768` | F — write-door lint rule and stale boundary doc correction |

`main` is at `8926768`. This project has no deploy and no PRs; a local merge to `main` is the terminal delivery step.

## Verification at close

Performed by the orchestrating agent directly, not delegated:

- `bunx jest --maxWorkers=4` → **109/109 suites, 654/654 tests, 0 failed**
- `npx eslint src/features` → **0 errors** (proves D2 routed all eight sites; F's rule would otherwise fail the build)
- `npx tsc --noEmit` → clean
- `npm run sqlite:lab` → 14 scenarios, 13 CONFIRMED, 1 FALSIFIED (H7 — a result, not a failure)

Every commit passed the real pre-commit gate (fallow, typecheck, eslint, full Jest, Stryker). `--no-verify` was never used.

Verified in code, not merely reported: `withExclusiveWrite` is absent from `src/`; the queue keys on `rawDb.databasePath`; `BEGIN IMMEDIATE` is issued through the async API and sits **outside** the rollback guard; all eight write sites use the door's `tx` handle; `close()` nulls the handle only after a proven close.

## Open follow-ups

1. **No lab arm proves a contended `claimSyncCycleLock` waits instead of throwing.** It is Jest-verified only — h9/h10's generic UPDATE workload does not exercise that conditional-UPSERT shape. Disclosed during apply rather than fabricated.
2. **`CLAUDE.md` constraint 9 still documents a destructive procedure.** It instructs `git checkout HEAD -- <file>` to restore a mutation. That is only safe once the feature is already committed at HEAD; on an uncommitted file — the normal mid-TDD state — it wipes the entire feature, not just the mutation. Hit twice during apply. Slice F corrected constraint 8, not 9.
3. **The Bridge Boundary may now be enforced by nothing.** `dlinter-ts-react`'s `infrastructure` edge governs import specifiers and runtime globals, not method calls, so it cannot express the `fetch()` / `new WebSocket()` ban the docs promise. Larger than this change; needs its own investigation.
4. **Which production connection leaked the write transaction is still UNKNOWN.** This change removes the entire bug class, but the original question is unanswered. Slice A's `errcode` / `elapsedMs` / `stage` telemetry is the instrument, and it needs a field build on the device to answer.
5. **PR1 was +2575/-7 across 36 files**, far over the 400-line review budget — the bulk being the `tests/sqlite-lab/` harness and the `openspec/` artifacts committed for the first time.

## Process finding worth keeping

The deepest cause was not in the code. **No test in this repository executes SQL**: `jest-expo` mocks `expo-sqlite`, so every defect here lived below the mock line. `tests/infrastructure/db/startup.helpers.test.ts` asserted the PRAGMA *string* and passed happily while three of six real connections never received it. `tests/sqlite-lab/` exists to close that gap; promoting a real-SQLite runner into the default gate was deliberately left as its own change.
