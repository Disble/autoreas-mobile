# Exploration — SQLite write-lock contention kills chapter mutations

Change: `sqlite-write-lock-contention`
Date: 2026-08-12
Status: exploration complete, evidence-backed

## Field report

The anime chapter `+`/`-` buttons intermittently stop working. When they do, a toast reports:

```
No se pudo guardar el capitulo
Call to function 'NativeStatement.runSync' has been rejected.
-> Caused by: Error code : database is locked
```

Observed symptoms:

| ID | Symptom |
| --- | --- |
| S1 | Intermittent; reported as worse when the bridge is unreachable |
| S2 | The failing statement is the `UPDATE`; the `SELECT` before it in the same transaction succeeded |
| S3 | The error text is byte-identical on every subsequent tap — it never becomes a different SQLite error |
| S4 | Reads keep working; the list renders, only the numbers are stale |
| S5 | Buttons render enabled and the tap fires |
| S6 | Persists across taps; only a full app close-and-reopen recovers, then it recurs at random |

## Root cause — two independent parts

### Part 1: the failure

Writes run inside a plain deferred `BEGIN`, then read, then write:

- `src/infrastructure/db/client/client.helpers.ts:240` — `withDeferredWrite` uses `rawDb.withTransactionAsync`
- `node_modules/expo-sqlite/build/SQLiteDatabase.js:120-130` — `withTransactionAsync` issues a plain `BEGIN` (deferred)
- `src/features/animes/anime-mutation.helpers.ts:234-241` — `fetchParsedAnime` (SELECT) then `txDb.update(animes)` (UPDATE)

In WAL, the `SELECT` pins a read snapshot. If another connection commits before the `UPDATE`, the write-lock upgrade returns `SQLITE_BUSY_SNAPSHOT` **immediately, without invoking the busy handler**. `PRAGMA busy_timeout = 5000` is therefore inert on this code path.

Amplifier: `busy_timeout` is per-connection and is applied in only two places (`src/infrastructure/db/startup/startup.helpers.ts:42` and `:71`). `withExclusiveTransactionAsync` opens a brand-new connection per call (`SQLiteDatabase.js:157`) that receives no pragma at all — SQLite default `0`. Three of six write-capable connections run with no timeout. The tap path reaches them: `anime-mutation.helpers.ts:262` fires `syncPendingOperations`, which takes `withExclusiveWrite` at `reconcile.helpers.ts:297` and again at `:413` on the offline catch path.

### Part 2: the permanence

Ordinary contention does **not** persist — it recovers on the next tap. S3 and S6 require an additional ingredient: a leaked, never-unwound write transaction on a still-live connection.

`src/features/sync/sqlite-sync-runtime.helpers.ts:78-86` drops the handle *before* attempting the close:

```ts
const currentDb = rawDb;
rawDb = null;                      // handle dropped first
await closeSyncRuntime(currentDb); // if this rejects, the connection is unreachable forever
```

`src/features/sync/notifee-foreground-service-adapter/notifee-foreground-service-adapter.helpers.ts:41-45` compounds it: `serviceRuntime = null` is never reached when `close()` throws, and the next `open()` creates a replacement while the old connection stays open.

## Evidence — real-SQLite harness

`tests/sqlite-lab/` (plain Node, `node:sqlite` 3.50.4, real `worker_threads`, WAL). Run with `npm run sqlite:lab`. Twelve falsifiable hypotheses, each with a prediction and a kill condition: **11 CONFIRMED, 1 FALSIFIED, 0 untestable**.

| ID | Claim | Verdict | Measured |
| --- | --- | --- | --- |
| H1 | Deferred read-then-write upgrade bypasses the busy handler | CONFIRMED | failed in 0.07ms, `errcode 517` (SQLITE_BUSY_SNAPSHOT) |
| H2 | No `busy_timeout` fails instantly; 5000 waits | CONFIRMED | 0.10ms vs 5534.59ms |
| H3 | `BEGIN IMMEDIATE` lets `busy_timeout` work | CONFIRMED | waited 536.10ms and **succeeded** |
| H4 | In WAL a held write txn blocks writers, not readers | CONFIRMED | SELECT ok (stale rows), UPDATE locked |
| H5 | A stuck write txn blocks every writer with an identical error | CONFIRMED | 5/5 failed, 1 distinct fingerprint |
| H6 | Closing the stuck connection releases the lock | CONFIRMED | close ok in 0.08ms, next write ok |
| H7 | SQLite refuses to close with unfinalized statements | **FALSIFIED** | close succeeded in 1.04ms |
| H8 | A lingering reader does not block writers; a writer does | CONFIRMED | reader: write ok; writer: locked |
| H9 | One serializer eliminates contention | CONFIRMED | control 931/1000 failures → 0/1000 |
| H10 | One bypassing writer reintroduces it | CONFIRMED | 363/1000 failures return |
| H11 | Abandoning a txn mid-flight changes the next error | CONFIRMED | next `BEGIN`: "cannot start a transaction within a transaction" |
| H12 | Full production shape reproduces | CONFIRMED | dose-response 0% / 11% / 41.5% / 100% |

H12 phase 1: 200 taps per contention level. All 305 failures on the `UPDATE` stage, all instant, **0 read failures out of 800** — reproducing S1, S2, S4, S5. Phase 2 added a leaked transaction and reproduced S3 and S6 exactly, with recovery only on teardown.

H11 is decisive for locating the leak: if the *tap* connection abandoned its transaction, the next tap would report `cannot start a transaction within a transaction` (errcode 1). Production never reports that. **The tap connection unwinds cleanly; the permanent blocker sits on a different, still-open connection.**

## Design constraints for the fix

1. `BEGIN IMMEDIATE` is necessary but **not sufficient**. Against a leaked transaction it converts an instant failure into a ~5.5s block followed by failure. The `IMMEDIATE` lock must be acquired through the **async** API before any synchronous drizzle statement runs, so the busy wait lands on expo's native thread rather than freezing the JS thread. Drizzle's expo-sqlite driver is fully synchronous (`session.js:73` `executeSync`).
2. A write serializer only works if it is the **only** door. H10 measured 363/1000 failures from a single bypasser, and most of the damage landed on *queued* writers. Production has **eight** direct `rawDb.runAsync` write sites outside the queue under `src/features/**` (exhaustive, re-verified 2026-08-12 via `rg "\.(runAsync|execAsync|runSync|execSync)\(" src/features`): `sync-cycle-lock.helpers.ts:22,39`; `season-rating-queue.helpers.ts:202,217`; `operation-log-retention.helpers.ts:36,64`; `season-sync.helpers.ts:99,118`.

   The two `sync-cycle-lock` sites were missing from the first draft of this document. They are not merely additional instances — `claimSyncCycleLock` and `releaseSyncCycleLock` are the primitive that serialises sync cycles across connections, so an unrouted `SQLITE_BUSY` there makes the coordination primitive itself fail under exactly the contention it exists to manage.
3. Connection policy must be applied at open time so implicitly created connections cannot skip it.
4. A naive timeout-and-advance design is **invalidated** by H11 — abandoning a transaction mid-flight corrupts connection state and changes the error class.

## Architectural findings

- The write queue keys on `rawDb as object` (`client.helpers.ts:206`), i.e. per connection, not per database file. Its docstring claims "per-database write ordering"; it delivers per-connection ordering.
- `withExclusiveWrite` queues on one connection then performs the write on another, outside every queue.
- The repo enforces a Bridge Boundary for transport via ESLint but has no analogous persistence boundary. Feature code opens connections (`sqlite-sync-runtime.helpers.ts:57`) and picks its own isolation level at runtime (`reconcile.helpers.ts:362`), defended only by a comment.
- `registerConcurrentStrategies` swallows every per-strategy failure, so the settings screen's `unsupported` state is most likely evidence that a database write already failed — not evidence that no background writer exists.

## Workflow finding

**No test in this repository executes SQL.** `jest.config.js` uses the `jest-expo` preset, which mocks `expo-sqlite`; there is no `better-sqlite3` or `node:sqlite` dependency. `tests/infrastructure/db/startup.helpers.test.ts` asserts the *string* `'PRAGMA busy_timeout = 5000;'` was passed — it passes while three of six real connections never receive it. Every defect above lives below the mock line. Stryker's `mutate` list excludes the persistence layer entirely.

## Open questions (not resolved by exploration)

1. Which production connection leaks the transaction. The harness cannot determine this; it needs the app runtime.
2. Whether an unreachable bridge genuinely raises write pressure. Contention → failure rate is measured; unreachable-bridge → contention is an untested inference.
3. H7's falsification is scoped to the `node:sqlite` API surface. It does not establish what expo-sqlite's binding does on close.

## Cheapest immediate diagnostic

The app cannot currently distinguish two different failures that print byte-identical text — the toast even renders `Error code :` with nothing after it. Capturing `errcode` alongside the message separates `5` (another writer holds the lock → leaked transaction elsewhere) from `517` (`BUSY_SNAPSHOT` → read-then-write racing). They indicate different fixes.
