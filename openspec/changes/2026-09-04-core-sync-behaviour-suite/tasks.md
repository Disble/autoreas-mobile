# Tasks: Core Sync Behaviour Suite

Ordered. Each task is TDD: write the test first, watch it fail, make it pass, then apply the constraint-9 stage-first mutation cycle to any guard introduced.

## Slice 1 — Harness (must be complete and independently tested before slice 2)

- [ ] **T1. `tests/support/sqlite-adapter.ts`** — wrap `node:sqlite` `DatabaseSync` in the `SQLiteDatabase` async surface. Implement exactly: `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`, `execSync`, `databasePath`. Every other property access must throw an error naming the missing member — use a `Proxy` or an explicit allowlist, never a silent `undefined`. `databasePath` returns a stable unique id per instance so the file-keyed write door keys correctly.
- [ ] **T2. `tests/support/__tests__/sqlite-adapter.test.ts`** — one test per implemented member against a real in-memory database, plus a test asserting an unimplemented member throws with the member name in the message.
- [ ] **T3. Schema loader** (in `sqlite-adapter.ts` or a sibling) — read `src/infrastructure/db/migrations/*.sql`, sort by filename, execute each. Assert in a test that a known production table exists afterwards (`animes`, `operation_log`, `bridge_config`, `season_rating_queue`, `pending_remote_changes`). Do NOT hand-write any `CREATE TABLE`.
- [ ] **T4. `tests/support/drizzle-test-factory.ts`** — bind `drizzle-orm/sqlite-proxy` to the adapter. **Critical:** the proxy callback gets `(sql, params, method)` with `method` in `run | all | get | values`; rows for `all`/`values`/`get` must be **positional arrays of column values in select order**, not objects. Objects make columns read back `undefined` and assertions pass on empty data.
- [ ] **T5. Drizzle factory tests** — prove all four `method` modes return correctly shaped rows, using a real table created by T3. This is the task most likely to be got wrong silently; do not skip it.
- [ ] **T6. `tests/support/fake-bridge.ts`** — programmable `globalThis.fetch` double. Records `{ method, url, headers, body }` per request. Replays queued responses in order. An unqueued request must throw loudly naming the url — never return a default `200`.
- [ ] **T7. `tests/support/__tests__/fake-bridge.test.ts`** — recording, ordered replay, and the unqueued-request throw.
- [ ] **T8. Mutation cycle** (constraint 9, stage-first) on two guards: the adapter's throw-on-unknown-member and the fake bridge's unqueued-request throw. `git add` while green, delete the guard, run only that test, confirm it FAILS, then `git checkout -- <file>`. Never `git add` after mutating; never `git checkout HEAD --` while uncommitted.
- [ ] **T9. `tests/support/sync-fixtures.ts`** — builders for anime rows, chapter state, outbox/operation-log rows, and bridge reconcile response payloads. Keep them minimal; add fields only when a flow needs them.

## Slice 2 — The five behaviour flows

Each test wires: real adapter + real migrations + real drizzle + real `withLocalWrite` + real `bridgeClient` singleton, with only `globalThis.fetch` faked. No `jest.mock` of any `src/` module except the `native-runtime.helpers` drizzle seam.

- [ ] **T10. `tests/behaviour/sync/chapter-sync.behaviour.test.ts`** — mark a chapter, assert an outbox row exists; run the reconcile cycle against a fake `202` with `applied_operations` confirming it; assert the operation row is `synced`, the cursor advanced, and the chapter state persisted.
- [ ] **T11. `tests/behaviour/sync/anime-sync.behaviour.test.ts`** — anime-level mutation round trip, same assertion shape.
- [ ] **T12. `tests/behaviour/sync/estado-sync.behaviour.test.ts`** — `buildSetEstadoPatch` through to confirmed local state.
- [ ] **T13. `tests/behaviour/sync/season-sync.behaviour.test.ts`** — `enqueueSeasonRatingIntent` then `drainSeasonRatingQueue`: a `204` deletes the row; a `500` leaves it `pending` with the row intact. Both directions asserted.
- [ ] **T14. `tests/behaviour/sync/inbound-changes.behaviour.test.ts`** — a bridge change applied through `applyRemoteChanges` lands in the database with expected fields.
- [ ] **T15. A10 characterization** — in T14's file, an `update` for an `_id` the device has never seen. Assert the CURRENT broken behaviour (record absent), name the test `characterizes A10: update for unknown _id is silently dropped`, and comment that MB-0c must invert this assertion. Do not fix the defect here.

## Slice 3 — Gate

- [ ] **T16.** Full suite green, including the pre-existing floor: 109 suites / 654 tests, plus the new files.
- [ ] **T17.** `bun run lint` clean on every staged file — `tests/` carries 128 of the 305 standing `dharness` findings, so JSDoc goes in as part of each new file, not afterwards.
- [ ] **T18.** `bun run typecheck` clean.

## Do not

- Modify any file under `src/`.
- Hand-write schema SQL.
- Mock `withLocalWrite`, `bridgeClient`, `applyRemoteChanges`, or any merge helper in the behaviour tests.
- Assert on call order or mock invocation anywhere in `tests/behaviour/`.
