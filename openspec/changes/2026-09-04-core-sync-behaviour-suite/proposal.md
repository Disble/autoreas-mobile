# Proposal: Core Sync Behaviour Suite

## Intent

The suite has 654 passing tests and cannot catch the bugs this redesign is about. That is not a coverage gap — nearly every sync module has a test file. It is a **seam** problem: the existing tests mock every boundary, so they assert that mocks were called in an order, never that a user action reaches the bridge and comes back durably applied.

`tests/features/sync/reconcile.helpers.test.ts:13-37` mocks `bridgeClient`, `withLocalWrite`, `applyRemoteChanges`, `loadGuardMap`, `loadPendingOutboxRecordIds`, `stagePendingRemoteChanges` and `readOperationLogBacklog` — every collaborator between the outbox and the database. A test shaped that way is structurally incapable of observing:

- a reconcile request body that does not match the bridge contract,
- a `202` that leaves the cursor unmoved (the measured defect: 0 of 97 advances across four devices),
- an operation never marked `synced`,
- **A10** — an `update` for a record the device has never seen issues a partial `UPDATE` that affects 0 rows and reports success.

Every one of those lives *between* the mocked units. The redesign is about to change exactly those seams, and there is currently no test that would notice a regression in chapter, anime, estado or season sync.

## Scope

### In Scope

- A test harness giving jest a **real SQLite database** (`node:sqlite`, already used by `tests/sqlite-lab`) behind a `SQLiteDatabase`-shaped adapter, with drizzle bound through `drizzle-orm/sqlite-proxy`.
- **One faked seam only: the wire.** `globalThis.fetch` is substituted; `resolveFetch()` (`bridge-client.helpers.ts:56`) falls back to it, so the real `bridgeClient` singleton, the real write door, real transactions, the real schema and the real wire mapping all execute.
- Behaviour tests for the four flows the product actually promises, each asserting persisted state rather than call order:
  - **chapter sync** — mark a chapter → outbox row → reconcile body → `202` → cursor advances and the operation is `synced`;
  - **anime sync** — anime-level mutation round trip;
  - **estado sync** — `buildSetEstadoPatch` through to confirmed local state;
  - **season sync** — rating intent enqueued, delivered, and the row cleared only on bridge confirmation.
- Inbound direction: a remote change applied through `applyRemoteChanges` lands in the database, **including the A10 case** — an `update` for an unknown `_id`. This test is expected to FAIL on current code, and is written as a characterization of the defect with an explicit marker.

### Out of Scope

- Fixing A10 (that is MB-0c). This change proves the defect; it does not repair it.
- Any production source change. This change adds tests and test infrastructure only.
- Replacing the existing 654 tests. They stay; unit tests and behaviour tests answer different questions.
- Anything requiring a device or `adb`.

## Capabilities

### New Capabilities
- `core-sync-behaviour-coverage`: the four user-visible sync flows are asserted end to end against a real database with only the network faked.

## Approach

Characterization first. The suite is written and green **before** MB-0a, MB-0b, MB-0c, MB-2a and MB-3 touch anything, so it records what the app does today and every later change has to keep it true. That ordering is the whole point: it is what turns "lo que ya funcionaba debe seguir funcionando" from an intention into a gate.

The harness inverts the existing mocking philosophy. Instead of replacing every collaborator, it replaces exactly one — the wire — and lets the rest run. Where a current test proves `withLocalWrite` was called, a behaviour test proves the row changed.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `tests/support/sqlite-adapter.ts` | New | `node:sqlite` wrapped in the `SQLiteDatabase` async surface actually used by `src/`: `execAsync`, `runAsync`, `getAllAsync`, `getFirstAsync`, `execSync`, `databasePath` |
| `tests/support/drizzle-test-factory.ts` | New | Binds `drizzle-orm/sqlite-proxy` to the adapter; mocks `native-runtime.helpers`'s `getDrizzleFactory` seam |
| `tests/support/fake-bridge.ts` | New | Programmable `globalThis.fetch` double, recording requests and replaying canned bridge responses |
| `tests/support/sync-fixtures.ts` | New | Builders for animes, chapters, outbox rows, bridge reconcile payloads |
| `tests/behaviour/sync/*.behaviour.test.ts` | New | The four flows plus the inbound direction |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| The adapter drifts from the real `expo-sqlite` surface, so tests pass against a fiction | **High — the central risk** | Enumerate the surface from actual call sites (`runAsync` 18, `execAsync` 7, `getFirstAsync` 6, `getAllAsync` 5, `execSync` 1, `databasePath` 1) and implement only those. Any method the app calls that the adapter lacks must throw loudly, never return undefined |
| `node:sqlite` is experimental in Node 22 and emits a warning | Low | Already depended on by `tests/sqlite-lab`; the warning is cosmetic |
| Behaviour tests become slow and the suite stops being run | Medium | Real DB is in-memory; keep the flow count small and the assertions on persisted state |
| The A10 characterization test is mistaken for a passing feature | Medium | It is marked as a known-defect characterization in its name and body, and MB-0c must flip it |
| Staged files inherit `dharness` JSDoc debt | High | `tests/` carries 128 of the 305 standing findings; write JSDoc as part of each new file |

## Rollback Plan

Delete the new test files and the `tests/support/` additions. No production code is touched, so revert cannot affect runtime behaviour.

## Dependencies

None. This change is deliberately first in the sequence, before MB-0a.

## Success Criteria

- [ ] Chapter, anime, estado and season sync each have a behaviour test asserting persisted state after a full round trip.
- [ ] Exactly one seam is faked (`globalThis.fetch`); no test in this suite mocks `withLocalWrite`, `bridgeClient`, or any merge helper.
- [ ] The inbound direction is covered, including a characterization of A10 that fails on current code and is explicitly marked as such.
- [ ] The adapter throws on any unimplemented `SQLiteDatabase` method rather than silently returning undefined.
- [ ] Regression floor holds: the existing 109 suites / 654 tests stay green.
- [ ] Every new guard gets the constraint-9 stage-first mutation cycle.
