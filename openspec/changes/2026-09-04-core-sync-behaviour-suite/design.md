# Design: Core Sync Behaviour Suite

## Principle

Replace exactly one collaborator — the wire — and let everything else run for real. Every seam the existing unit tests mock is a seam where the measured defects live, so each mock removed is a class of bug the suite becomes able to see.

## D1 — Schema comes from the app's own preparation pipeline (revised)

**The first version of this decision was wrong, and the correction matters more than the original.** It said: apply `src/infrastructure/db/migrations/*.sql` in filename order, because that is "the real schema". It is not.

`prepareDatabaseSchema` (`src/infrastructure/db/client/client.helpers.ts:239-248`) is a **two-part** pipeline — the drizzle migrator, then eight ordered `ensure*` repair steps:

```
migrate(db, migrations);                    // :239-240
ensureBridgeConfigLastChangelogId           // :241
ensureSyncRuntimeStatusExecutionColumns
ensureOperationLogRetentionIndex
ensureAnimesGuardColumn
ensurePendingRemoteChangesTable
ensureSeasonRatingQueueTable
ensureActiveSeasonCacheTable                // :247
ensureSyncCycleLockTable                    // :248
```

Two of the eight `REQUIRED_SCHEMA_TABLES` (`startup.constants.ts:8-17`) appear in **zero** migration files — verified by grepping all ten:

- `sync_cycle_lock` — created only by `ensureSyncCycleLockTable` via `SYNC_CYCLE_LOCK_TABLE_SQL`
- `active_season_cache` — created only by `ensureActiveSeasonCacheTable`

A migrations-only harness therefore builds a database missing both, and nothing fails until a behaviour test runs a reconcile cycle and takes the sync cycle lock — dying on `no such table: sync_cycle_lock`, several layers from the cause.

**The revised decision:** mock **both** native-runtime seams — `getDrizzleFactory` *and* `getDrizzleMigrator` — make the fake migrator apply the migration SQL files in filename order, and then call the app's own exported `runMigrations(adapter)` (`client.helpers.ts:253-255`).

This is higher fidelity than the original, not merely a patch. The eight repair steps execute for real, the schema is byte-for-byte what the app produces at startup, and a future `ensure*` step is picked up with no harness change at all.

**The assertion that catches this class of error:** after `runMigrations`, assert every entry of `REQUIRED_SCHEMA_TABLES` exists, importing the constant rather than retyping the list so it tracks the app. That assertion would have caught the original mistake, which is precisely why it belongs in the harness rather than in a reviewer's head.

## D2 — Adapter surface is enumerated from real call sites, and is loud about gaps

The app touches `SQLiteDatabase` through exactly six members. Counted across `src/`:

| Member | Call sites |
|---|---|
| `runAsync` | 18 (10 `rawDb`, 8 `tx`) |
| `execAsync` | 7 |
| `getFirstAsync` | 6 |
| `getAllAsync` | 5 |
| `execSync` | 1 |
| `databasePath` | 1 |

`tests/support/sqlite-adapter.ts` implements those six over `node:sqlite`'s `DatabaseSync` and **nothing else**.

Any other member must throw an explicit error naming the missing method. This is the single most important rule in the harness: a stub that silently returns `undefined` produces a suite that is green against a fiction, which is worse than no suite — it is the same failure mode as the mocked tests this change exists to replace. `databasePath` returns a stable per-test identity so the file-keyed write door (`client.constants.ts:19`) keys correctly.

## D3 — Drizzle is bound through `sqlite-proxy`, injected at the existing seam

`createDrizzleDb` (`client.helpers.ts:112-115`) calls `getDrizzleFactory()` from `src/infrastructure/db/native-runtime/native-runtime.helpers.ts:140`, which lazily loads `drizzle-orm/expo-sqlite`. That lazy load is already a seam. The harness `jest.mock`s that module so `getDrizzleFactory` returns a `drizzle-orm/sqlite-proxy` instance bound to the adapter.

`better-sqlite3` is not installed and is not needed; `sqlite-proxy` takes an arbitrary async executor, which is precisely what an adapter can provide.

**Implementation hazard to get right — verified in the driver source, not inferred.** The proxy callback receives `(sql, params, method)` where `method` is `run | all | get | values`, and the four modes do not share one shape. From `node_modules/drizzle-orm/sqlite-proxy/session.js`:

| `method` | Driver code | Required return |
|---|---|---|
| `all` | `:117` — `rows.map((row) => mapResultRow(...))` | `{ rows: [[v1, v2, …], …] }` — array of rows, each a positional array in select order |
| `get` | `:143-157` — `mapGetResult(clientResult.rows)` then `const row = rows;` | `{ rows: [v1, v2, …] }` — **`rows` IS the row**, flat, not wrapped |
| `values` | `:169` — returns `clientResult.rows` unchanged | `{ rows: [[v1, v2, …]] }` |
| `run` | no row mapping | `{ rows: [] }` |

`all` and `get` are **not symmetric**: wrapping a `get` result in an outer array yields a row whose first column is an array. Nothing throws — the declared type at `driver.d.ts:12` is only `Promise<{ rows: any[] }>`, so TypeScript catches none of it, and a wrong shape reads back as `undefined` columns while assertions pass on empty data. That is the same silent-fiction failure this whole change exists to remove.

Rows must be **positional arrays in select order**, never objects keyed by column name.

**`node:sqlite` supplies exactly these shapes natively — no conversion layer is needed.** Probed under this project's jest config, the statement prototype exposes `setReturnArrays`, and with it:

```
SELECT name, n, id FROM t ORDER BY id
  .all()  ->  [["alpha",7,1],["beta",9,2]]      positional, in SELECT order
SELECT name, n FROM t WHERE id = ?
  .get(2) ->  ["beta",9]                         flat positional array
UPDATE t SET n = ? WHERE id = ?
  .run()  ->  {"lastInsertRowid":2,"changes":1}
```

So the mapping is direct: `all`/`values` return `{ rows: stmt.all(...) }`, `get` returns `{ rows: stmt.get(...) }` unwrapped, `run` returns `{ rows: [] }`. An earlier draft of this design specified deriving column order from statement metadata; that mitigation is deleted, because hand-rolled ordering logic is precisely where a silent wrong-shape bug would hide and `setReturnArrays` removes the need for it. One caution remains: `get()` yields `undefined` when nothing matches, so return `{ rows: [] }` rather than `{ rows: undefined }`.

**Environment is verified, not assumed:** a test importing `DatabaseSync` from `node:sqlite` and round-tripping a row passes under `jest-expo` with no `@jest-environment` docblock and no config change, in 0.858 s.

T5 must still assert an actual column *value* in all four modes, not merely a row count. It is now cheap to satisfy, which is the point.

## D4 — The wire is the only double

`resolveFetch()` (`bridge-client.helpers.ts:56`) returns `dependencies.fetchFn ?? globalThis.fetch`, and the shared `bridgeClient` singleton (`:147`) is constructed with no dependencies. So assigning `globalThis.fetch` substitutes the transport for the **real** singleton that feature code imports — no module mock, no injected client, no divergence between what the test exercises and what ships.

`tests/support/fake-bridge.ts` provides a programmable double that records every request (method, url, headers, parsed body) and replays queued responses. Recording headers is what lets a later change assert `X-Sync-Cycle-Id` (MB-0b) without reshaping the harness.

## D5 — Tests assert persisted state, never call order

A behaviour test's assertions read the database after the flow. `expect(withLocalWrite).toHaveBeenCalled()` is banned in this suite by construction, because nothing is mocked to assert against.

Location: `tests/behaviour/sync/*.behaviour.test.ts`. jest picks these up with no config change — `roots` is `<rootDir>/tests` and `testMatch` is `['**/*.test.ts', '**/*.test.tsx']`.

## The five flows

| Flow | Exercises | Asserts after the round trip |
|---|---|---|
| **chapter** | mark chapter → outbox row → `buildReconcileRequestBody` → fake `202` → confirmation | operation row is `synced`, cursor advanced, chapter state persisted |
| **anime** | anime-level mutation round trip | same shape at anime granularity |
| **estado** | `buildSetEstadoPatch` → outbox → reconcile → confirmation | estado persisted, operation `synced` |
| **season** | `enqueueSeasonRatingIntent` → `drainSeasonRatingQueue` → `204` | queue row deleted only on confirmation; a `500` leaves it `pending` |
| **inbound** | bridge change → `applyRemoteChanges` | row present with expected fields |

## The A10 characterization

The inbound flow includes an `update` for an `_id` the device has never seen. On current code `applyAcceptedChange` issues a partial `UPDATE` that matches 0 rows and reports success, so the record never appears.

That test is written to **assert the current broken behaviour**, named `characterizes A10: update for unknown _id is silently dropped`, with a comment naming MB-0c as the change that must flip it. Writing it green-against-the-defect is deliberate: it documents the bug executably, and MB-0c inverting the assertion is the proof the fix landed. A test that merely failed here would be indistinguishable from a broken harness.

## Test strategy for the harness itself

The harness is test infrastructure, so it gets its own tests before anything depends on it:
- `sqlite-adapter` — each of the six members; unimplemented member throws.
- `drizzle-test-factory` — all four proxy `method` modes return correctly shaped rows.
- `fake-bridge` — records requests, replays queued responses in order, fails loudly on an unqueued request.

Constraint-9 stage-first mutation applies to the adapter's throw-on-unknown-method guard and to the fake bridge's unqueued-request guard. Both are guards whose deletion would leave a silently-passing suite, which is exactly the class constraint 9 exists for.

## File plan

| File | Lines (est.) |
|---|---|
| `tests/support/sqlite-adapter.ts` | 110 |
| `tests/support/drizzle-test-factory.ts` | 70 |
| `tests/support/fake-bridge.ts` | 90 |
| `tests/support/sync-fixtures.ts` | 80 |
| `tests/support/__tests__/sqlite-adapter.test.ts` | 90 |
| `tests/support/__tests__/fake-bridge.test.ts` | 60 |
| `tests/behaviour/sync/chapter-sync.behaviour.test.ts` | 90 |
| `tests/behaviour/sync/anime-sync.behaviour.test.ts` | 70 |
| `tests/behaviour/sync/estado-sync.behaviour.test.ts` | 70 |
| `tests/behaviour/sync/season-sync.behaviour.test.ts` | 80 |
| `tests/behaviour/sync/inbound-changes.behaviour.test.ts` | 90 |

Total ≈ 800, at the review budget. If the tasks forecast exceeds it, split at the natural seam: harness + harness tests first, the five flows second.

## Constraints honoured

- No production source file is modified.
- No device, no `adb`; everything runs in jest.
- Regression floor: 109 suites / 654 tests stay green.
- New files carry JSDoc per constraint 12 — `tests/` holds 128 of the 305 standing `dharness` findings, so this is not optional.
