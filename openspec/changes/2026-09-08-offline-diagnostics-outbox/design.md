# Design: Offline Diagnostics Outbox

## Technical Approach

**Write the envelope down before you try to send it, then let every existing trigger drain the queue.**

Three seams, no new scheduler, no new timer:

1. **Wire type** — `degraded` becomes a field of `WireSyncCycleTelemetry` itself, set by `capWireSyncCycleTelemetry` as it sheds. The outbox row then stores the serialized wire object verbatim, so the reconcile body and the row are not two consumers of one value: they are **one value**.
2. **Store** — `sync_diagnostics_outbox` in the existing `autoreas-telemetry.db`, synchronous `runSync`/`getAllSync` on a private connection, cap and FIFO eviction enforced in SQL.
3. **Flush** — an unconditional, never-rejecting attempt inside `performSyncPendingOperations`, lexically outside the reconcile `try`, gated by a clock comparison folded into the candidate `SELECT`.

The organising timing invariant extends the chain the `background-sync-bounded-awaits` design pinned:

| # | Constant | Value | Why it must be below the next |
|---|---|---|---|
| 0 | `SYNC_DIAGNOSTICS_OUTBOX_BUSY_TIMEOUT_MS` | `250` | Same argument as the checkpoint's: only this process writes this file, and `busy_timeout` is the one bound that actually fires when JS timers are paused. |
| 1 | `SYNC_DIAGNOSTICS_REQUEST_TIMEOUT_MS` | `3_000` | A diagnostics POST must never cost what the reconcile POST costs. Passed via the existing `BridgeRequestSpec.timeoutMs` override. |
| 2 | `BRIDGE_REQUEST_TIMEOUT_MS` | `10_000` (existing) | The primary work keeps the larger budget. |
| 3 | `SYNC_DIAGNOSTICS_FLUSH_BATCH_SIZE × (1) + (2)` | `3 × 3_000 + 10_000 = 19_000` | **Load-bearing:** the whole cycle's network worst case must sit under the cycle deadline, or instrumentation kills the cycle it instruments. |
| 4 | `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` | `45_000` (existing) | Unchanged. |

Row 3 is asserted by one constants-order unit test, exactly like the existing seven-constant chain test.

## Architecture Decisions

### Decision 1 — `degraded` is a field of `WireSyncCycleTelemetry`, not a second return value

**Choice**: add `readonly degraded: SyncCycleTelemetryDegradedTier` as the **second** key of `WireSyncCycleTelemetry`; `toWireSyncCycleTelemetry` emits it as `null`; each shedding branch in `capWireSyncCycleTelemetry` sets it. The signature stays `WireSyncCycleTelemetry | null`.

| Option | Tradeoff | Decision |
|---|---|---|
| Field on the wire type | Zero signature churn; `resolveClientTelemetry` stays the single exit unchanged | **Chosen** |
| Return `{ wire, degraded }` tuple/wrapper | Every caller and both existing test suites rewrite; `resolveClientTelemetry` must re-wrap or unwrap, adding a second place the two can drift | Rejected |
| Recompute at the outbox call site | Precisely the drift the proposal names as a Medium risk | Rejected |

**Rationale**: `degraded` **is** part of the wire contract — the bridge requires it. A value that belongs on the wire belongs on the wire type. The decisive consequence is that the outbox row can be `JSON.stringify(wire)` with nothing added, so "the body and the row carry the same `degraded`" stops being a property somebody has to maintain and becomes an identity. `resolveClientTelemetry` remains the single exit to the wire, untouched.

**Three non-obvious properties this relies on:**

- **Key position survives spreading.** JS object spread preserves the insertion order of keys that already exist and only appends genuinely new ones, so `{ ...wire, degraded: 'events' }` leaves `degraded` in slot 2 where `toWireSyncCycleTelemetry` put it. `JSON.stringify` then emits it second, as the bridge requires. Nothing needs to rebuild the object to reposition it.
- **Byte accounting stays honest.** `measureWireBytes` now counts the `degraded` key, because the payload really carries it. Set the tier on the intermediate *before* measuring it, or the cap under-reports by up to 12 bytes.
- **Last writer wins is the correct rule.** The shed order is fixed (`events` → `error_detail` → `previous_cycle`), so plain overwrite during the recursion yields the heaviest tier reached. That matches the pinned bridge semantics exactly: *each value implies every lighter piece is ABSENT from this payload — shed or never present; it does not assert a lighter piece was dropped.* An envelope that arrives with `degraded: "error_detail"` and an empty `recent_events` it never had is therefore **correct**, not a lie, and no code is needed to distinguish the two cases.

### Decision 2 — `Retry-After` is parsed in `bridge-url.helpers.ts`, delta-seconds first

**Choice**: `BridgeHttpResult` gains `readonly retryAfterMs: number | null`. `request()` reads the header defensively and hands it to a pure `parseRetryAfterMs(rawHeader, now)` in `bridge-url.helpers.ts`.

```ts
export function parseRetryAfterMs(rawValue: string | null, now: number): number | null {
  if (rawValue === null) return null;
  const trimmed = rawValue.trim();

  // Delta-seconds is tried FIRST and matched strictly. `Date.parse('2000')` yields a valid
  // year-2000 date in V8/Hermes, so a legitimate 2000-second delay would silently become a
  // 26-year backoff if the date branch ran first.
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1_000, SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS);
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isNaN(parsedDate)) return null;

  return Math.min(Math.max(parsedDate - now, 0), SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS);
}
```

| Input form | Result |
|---|---|
| `"120"` (delta-seconds, RFC 9110 §10.2.3) | `120_000` |
| HTTP-date the engine can parse | `max(date − now, 0)`, clamped |
| HTTP-date already in the past | `0` — the gate opens immediately |
| Header absent, empty, negative, fractional, `"soon"`, or a date the engine rejects | `null` — treated as "no server-directed backoff", never as zero-with-meaning |
| Any accepted value above the cap | `SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS` (`3_600_000`) |

**Rationale for the upper bound**: the not-before is **persisted**. Without a clamp, one wrong header or one wrong device clock wedges diagnostics delivery for years, and the wedge survives restart. One hour is far above any plausible bridge backoff and far below the ~25 h horizon at which the 100-row cap evicts the backlog anyway, so the clamp can never be the thing that loses data.

**Honest limitation**: `Date.parse` is only *specified* for ISO-8601; IMF-fixdate support is implementation-defined. Under Hermes an unparseable date yields `NaN` and therefore `null`, which is the safe direction. The bridge contract sends delta-seconds; the date branch is defensive, not relied upon, and no test asserts engine-specific date parsing.

### Decision 3 — Table DDL, and eviction as an `AFTER INSERT` trigger

Inline `CREATE ... IF NOT EXISTS` on connect, no migrations — the checkpoint file's established pattern.

```sql
CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox (
  cycle_id   TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_diagnostics_outbox_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  not_before INTEGER NOT NULL
);
```

`payload` is the exact JSON that would have gone on the wire. There is deliberately **no** `degraded` column: it is already inside `payload` (Decision 1), and a second copy is a second thing that can disagree.

`cycle_id TEXT PRIMARY KEY` leaves an implicit `rowid`, which gives monotonic insertion order for free — so FIFO is `ORDER BY created_at ASC, rowid ASC` and stays deterministic even if two cycles land in the same millisecond or the device clock moves backwards.

```sql
-- Insert. DO NOTHING, not DO UPDATE: `syncPendingOperations`'s rerun loop re-enters
-- `performSyncPendingOperations` with the SAME telemetryContext and therefore the same cycle_id
-- (reconcile.helpers.ts:119-126). The first capture wins, and `created_at` never churns, so the
-- FIFO order and the eviction accounting stay stable across a rerun.
INSERT INTO sync_diagnostics_outbox (cycle_id, payload, created_at)
VALUES (?, ?, ?)
ON CONFLICT(cycle_id) DO NOTHING;
```

```sql
-- Eviction. Dropped and recreated on every connect so the cap is owned by the code, not frozen
-- into DDL that `IF NOT EXISTS` would refuse to update on an already-provisioned device.
-- ${MAX} is interpolated from SYNC_DIAGNOSTICS_OUTBOX_MAX_ROWS -- a numeric constant we own; a
-- trigger body cannot bind a parameter.
DROP TRIGGER IF EXISTS sync_diagnostics_outbox_evict;
CREATE TRIGGER sync_diagnostics_outbox_evict
AFTER INSERT ON sync_diagnostics_outbox
WHEN (SELECT COUNT(*) FROM sync_diagnostics_outbox) > ${MAX}
BEGIN
  DELETE FROM sync_diagnostics_outbox WHERE rowid IN (
    SELECT rowid FROM sync_diagnostics_outbox
    ORDER BY created_at ASC, rowid ASC
    LIMIT (SELECT COUNT(*) FROM sync_diagnostics_outbox) - ${MAX}
  );
END;
```

| Option | Tradeoff | Decision |
|---|---|---|
| `AFTER INSERT` trigger | One `runSync` from JS; eviction is atomic with the insert and holds for every future writer, including one that forgets | **Chosen** |
| Two `runSync` calls in `withTransactionSync` | Cap binds as a parameter and all logic is visible in TS; but it is two statements and a future writer can bypass the second | Rejected |
| Periodic cleanup pass | A background job, which this whole file exists to avoid | Rejected |

**Rationale**: this is the same argument the checkpoint's upsert already makes — *"ordering is enforced in SQL rather than by chaining the writes in JS on purpose: a JS chain is exactly the jammed-queue failure this instrument exists to survive."* The bound that must hold when JS is unreliable belongs in SQLite.

### Decision 4 — Flush: 3 oldest per cycle, stop at first link failure, delete on 2xx and on envelope rejection

```
readFlushCandidates(3, now)   ──→ [] when the queue is empty OR the gate is shut (one case)
  for each row, oldest first:
    POST /api/sync/diagnostics  (timeout 3 s)
      2xx  ──→ remove(cycle_id)                     ── delivered
      400/413/422 ──→ remove(cycle_id) and CONTINUE ── THIS envelope is malformed
      other 4xx ──→ deferUntil(now + retryAfterMs) if present; leave row; STOP
      5xx  ──→ deferUntil(now + retryAfterMs) if present; leave row; STOP
      throw ──→ leave row; STOP
```

- **Batch of 3** — bounded by the timing chain above (3 × 3 s + 10 s reconcile = 19 s, comfortably inside the 45 s cycle deadline). Every trigger is a flush opportunity, so throughput comes from cadence, not batch size: the FGS ticker alone drains a full 100-row backlog in about 8 minutes.
- **Oldest first** — the same order eviction uses, so the row closest to being destroyed is the row sent first.
- **DELETE on 2xx, no `delivered` flag** — a flag needs a purge pass (rejected in Decision 3), and delivered rows would occupy the cap and starve undelivered ones. The bridge's *duplicate `cycle_id` is 2xx* contract means we never need proof of prior delivery, so a delivered row carries no information.
- **DELETE only on `400`/`413`/`422`** — the responses that mean *this envelope* is malformed. The bridge designed `400` to name the offending field, so it will reject the same bytes identically forever; because that row sits at the FIFO head, retrying wedges the queue while spending a POST every cycle. Deleting it is the only termination.

  **This deliberately does NOT reuse `isPermanentReconcileError`** (`reconcile.helpers.ts:62-64`, `>= 400 && < 500`). Orchestrator decision, overriding the draft: that taxonomy is correct for reconcile, where a 4xx condemns the *operation*, and wrong here, where most 4xx condemn nothing about the envelope.

  The governing principle is narrower and safer: **drop only what is wrong with THIS envelope; preserve anything that is wrong with the link or the endpoint.**

  - **`404` is the case that forced this.** The bridge endpoint is not built yet. Under a blanket 4xx rule, every POST during the dual-write window returns `404`, every row is deleted, and the queue drains silently — reproducing precisely the invisible-loss failure this change exists to eliminate. Before the endpoint ships `404` means "not deployed"; after it ships `404` means a routing bug. The envelope is valid in both cases and deleting it serves no one.
  - **`408`/`429` are preserved too.** The draft accepted dropping them as a known imprecision. They are transient by definition, and `429` in particular is backpressure — discarding evidence because the bridge asked us to slow down inverts the intent.
  - **No starvation risk.** A per-envelope rejection is specific to one row, which is why it must be dropped. A link- or endpoint-level failure affects *every* row equally, so nothing is deliverable and nothing is starved; once the condition clears, the whole queue becomes deliverable at once. The 100-row cap with FIFO eviction bounds the wait either way.
  - Non-envelope 4xx therefore **STOPS** the batch like a 5xx, rather than continuing: the next two rows would fail identically.
- **An envelope-rejection drop is silent, deliberately** — a `400` is by definition a *reachable-bridge* event whose response body names the offending field, so the bridge already holds the evidence. Emitting a new ring event would add a vocabulary entry to buy nothing.
- **Stop at the first transient failure** — a transport throw or 5xx means the link or the bridge is down; the next two rows would fail identically and burn 6 s of the cycle deadline proving it.

### Decision 5 — The flush cannot fail the cycle: two independent barriers

**Choice**: `flushSyncDiagnosticsOutbox` **never rejects** — it catches internally and returns a plain result — **and** its call site sits lexically *before* the `try` at `reconcile.helpers.ts:370`.

```ts
// reconcile.helpers.ts, after requestBody is built (~:368), BEFORE the try:
captureSyncDiagnosticsEnvelope(clientTelemetry);        // sync, swallows by contract
await flushSyncDiagnosticsOutbox({ connection, ... });  // never rejects

try {
  const result = await bridgeClient.reconcile(connection, requestBody);
```

**Rationale**: one barrier would be enough if it were guaranteed, so build the one that *is*. The never-rejecting contract is the house pattern verbatim — `sync-cycle-checkpoint.helpers.ts:88-93`, *"Swallowed by contract: instrumentation must never be the reason a cycle fails."* The placement is the structural half: inside that `try`, any throw reaches `catch (error) { await revertPendingOperationsOnFailure(...); throw error; }`, which would not merely fail the cycle — it would **dead-letter or requeue the user's pending mutations because a diagnostics POST failed**. That is a data-integrity consequence, not an availability one, and lexical placement outside the block is what makes it unreachable.

Placement *before* the reconcile POST rather than after is also deliberate: the row just captured becomes a flush candidate on the same cycle in the healthy case, so a working link never adds a cycle of delivery latency. The cost when the link is down is exactly one 3 s timeout, by the stop-at-first-failure rule.

Both calls sit outside every `withLocalWrite` callback, which the shipped `no-restricted-syntax` selector (`eslint.config.mjs`, `background-sync-bounded-awaits` Decision 7) already enforces for `bridgeClient.*`.

### Decision 6 — The not-before lives in a singleton row and is read *inside* the candidate SELECT

**Choice**: `sync_diagnostics_outbox_state` (singleton, same file), and the gate is a sub-select in the candidate query — never a JS branch, never a `setTimeout`.

```sql
SELECT cycle_id, payload, created_at
FROM sync_diagnostics_outbox
WHERE COALESCE((SELECT not_before FROM sync_diagnostics_outbox_state WHERE id = 1), 0) <= ?
ORDER BY created_at ASC, rowid ASC
LIMIT ?;
```

```sql
INSERT INTO sync_diagnostics_outbox_state (id, not_before) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET not_before = excluded.not_before;
```

| Option | Tradeoff | Decision |
|---|---|---|
| Singleton row + gate folded into the SELECT | One statement, one caller case, no JS branch to forget | **Chosen** |
| Singleton row + separate read + `if` in JS | Two statements and a guard a future caller can skip | Rejected |
| In-memory module variable | **Fatal** — the headless task is a fresh JS runtime per invocation; the value would never survive to the cycle it must gate | Rejected |
| A column on `bridge_config` in `autoreas.db` | Routes the read back through the failure domain the outbox exists to escape | Rejected |

**Rationale**: this is `sync-cycle-lock.helpers.ts:34`'s `WHERE sync_cycle_lock.expires_at <= ?` applied to a different clock — a persisted timestamp compared at cycle start, with SQLite doing the comparison. Folding it into the SELECT gives the caller exactly **one** case to handle (`[]` means "nothing to send *or* the gate is shut"), which is the same property `resolveClientTelemetry` is documented to provide: *"the caller has exactly one case to handle."*

The gate is written **only** when a response carries a parseable `Retry-After`. It is never cleared, because a past timestamp is already open, and a transport failure never sets it: offline is the normal case, and the trigger cadence (15 s FGS / 15 min headless) already *is* the backoff. Inventing client-side backoff would be a second scheduler.

### Decision 7 — Synchronous reads and writes, on a private connection

**Choice**: `runSync` for insert/delete/gate-write and `getAllSync` for the candidate read, on the store's own `useNewConnection: true, enableChangeListener: false` handle with `busyTimeoutMs: 250`.

**Rationale**: unchanged from the checkpoint store, and it is the reason the store exists at all — *"the environment this instrument has to survive is one where JS timers are paused and the shared write queue is jammed, so anything routed through a promise, a queue or a timer can silently never complete."* The reads are synchronous too, deviating from the checkpoint's `getFirstAsync`, on the same argument the constants file already makes: `busy_timeout`, enforced natively inside SQLite, is the only bound that fires in the headless runtime. A ≤3-row read of a private file gains nothing from yielding and gains a bound from not yielding.

`withLocalWrite` is rejected outright — that is the failure domain being escaped.

### Decision 8 — `installFakeBridge` must grow headers before `request()` reads them

**Verified breakage, not a hypothetical.** `tests/support/fake-bridge.helpers.ts:61-65` returns a stub cast to `Response` carrying only `ok`, `status`, `text`. An unguarded `response.headers.get('Retry-After')` in `request()` throws `Cannot read properties of undefined (reading 'get')` and takes **all four** existing behaviour suites down with it.

Two changes, both required:

- `request()` reads defensively: `typeof response.headers?.get === 'function' ? response.headers.get('Retry-After') : null`. Production `Response` always has headers; this guard exists for doubles, and it is what keeps the adapter honest about what it actually requires.
- `QueuedBridgeResponse` gains an optional `headers?: Record<string, string>`, and the fake synthesises a minimal case-insensitive `headers.get`. Without it, no behaviour test can exercise a `503` + `Retry-After` at all.

## Data Flow

```
runHeadlessSyncCycle
  └─ drainDiagnosticEvents()  :77   (UNCHANGED -- ring emptied here, as today)
       └─ performSyncPendingOperations
            ├─ clientTelemetry = resolveClientTelemetry(...)   :341  ── degraded set here
            ├─ requestBody = buildReconcileRequestBody(...)    :362  ── carries the SAME object
            │
            ├─ captureSyncDiagnosticsEnvelope(clientTelemetry)       ── runSync, swallows
            │     └── INSERT ... DO NOTHING ──▶ AFTER INSERT trigger evicts oldest over 100
            │
            ├─ flushSyncDiagnosticsOutbox()                          ── never rejects
            │     ├── getAllSync(gate <= now, LIMIT 3)
            │     └── POST /api/sync/diagnostics  ─2xx/4xx▶ remove   ─5xx▶ deferUntil + stop
            │                                                             │
            └─ try { bridgeClient.reconcile(...) } catch { revert; throw }│
                     ▲                                                    │
                     └─ the flush is OUTSIDE this try, so nothing above ──┘
                        can reach revertPendingOperationsOnFailure

            autoreas-telemetry.db  (private connection, busy_timeout 250 ms, no write door)
              sync_cycle_checkpoint | sync_diagnostics_outbox | sync_diagnostics_outbox_state
```

## File Impact

| File | Action | What changes | ~lines |
|---|---|---|---|
| `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.constants.ts` | New | DDL, trigger, insert/select/delete/gate SQL, cap, busy timeout | 60 |
| `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.types.ts` | New | Row, entry, store params, store interface | 45 |
| `src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.helpers.ts` | New | `createSyncDiagnosticsOutboxStore` — connect, enqueue, read, remove, deferUntil, failed-write counter | 110 |
| `src/infrastructure/db/sync-diagnostics-outbox/index.ts` | New | Pure barrel | 10 |
| `src/infrastructure/api/bridge-client/bridge-client.constants.ts` | Modify | `syncDiagnostics` path; `SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS` | 10 |
| `src/infrastructure/api/bridge-client/bridge-client.types.ts` | Modify | `retryAfterMs` on `BridgeHttpResult`; `postSyncDiagnostics` on `BridgeClient` | 8 |
| `src/infrastructure/api/bridge-client/bridge-url.helpers.ts` | Modify | `parseRetryAfterMs` (pure) | 35 |
| `src/infrastructure/api/bridge-client/bridge-client.helpers.ts` | Modify | Defensive header read; `retryAfterMs` on the result; `postSyncDiagnostics` | 15 |
| `src/infrastructure/api/bridge-client/index.ts`, `src/infrastructure/api/index.ts` | Modify | Re-export the new surface | 6 |
| `src/features/sync/sync-telemetry.types.ts` | Modify | `SyncCycleTelemetryDegradedTier`; `degraded` as key 2 | 12 |
| `src/features/sync/sync-telemetry.helpers.ts` | Modify | Emit `degraded: null`; set the tier in each shedding branch | 20 |
| `src/features/sync/sync-diagnostics-flush.constants.ts` | New | Batch size, request timeout | 35 |
| `src/features/sync/sync-diagnostics-flush.types.ts` | New | Flush params and result | 25 |
| `src/features/sync/sync-diagnostics-flush.helpers.ts` | New | Capture + flush algorithm (Decision 4), never rejects | 90 |
| `src/features/sync/reconcile.helpers.ts` | Modify | Two calls before the `try` at `:370` | 25 |
| **`src/` subtotal** | | | **~506** |
| `tests/infrastructure/db/sync-diagnostics-outbox.helpers.test.ts` | New | Insert/read/remove; **eviction at the exact 100 boundary**; DO NOTHING on rerun; no `withLocalWrite` | 140 |
| `tests/infrastructure/api/bridge-client-retry-after.test.ts` | New | Every row of Decision 2's table; the `"2000"` misparse; clamp; header-less double | 110 |
| `tests/features/sync/__tests__/sync-telemetry-degraded.test.ts` | New | Tier per shed level; key position 2 after `JSON.stringify`; byte accounting includes it | 90 |
| `tests/features/sync/__tests__/sync-diagnostics-flush.helpers.test.ts` | New | 2xx/4xx/5xx/throw dispositions; stop-at-first-failure; gate closed → no POST | 150 |
| `tests/features/sync/__tests__/sync-diagnostics-timing-order.test.ts` | New | The row-3 constants chain | 30 |
| `tests/features/sync/reconcile.helpers.test.ts` | Modify | A throwing `reconcile` still leaves the row; a throwing flush does not reach the revert | 60 |
| `tests/behaviour/sync/diagnostics-outbox-round-trip.behaviour.test.ts` | New | Real SQLite: queue under a faked failure, drain on a later cycle under a faked success | 130 |
| `tests/support/fake-bridge.helpers.ts`, `fake-bridge.types.ts` | Modify | Optional response headers (Decision 8) | 25 |
| `tests/support/__tests__/fake-bridge.test.ts` | Modify | Headers replayed; absent headers still work | 25 |
| **`tests/` subtotal** | | | **~760** |
| **Total** | | | **~1266** |

Every file staged inherits its standing `dharness/require-jsdoc` and `require-variable-jsdoc` debt (constraint 12). JSDoc is written as part of each edit, never as a bulk pass, and is included in the estimates above. `role-file-shape` is why every constant above lands in a `.constants.ts` sibling.

## Interfaces / Contracts

```ts
// src/features/sync/sync-telemetry.types.ts
export type SyncCycleTelemetryDegradedTier = null | 'events' | 'error_detail' | 'previous_cycle';

export interface WireSyncCycleTelemetry {
  readonly cycle_id: string;
  readonly degraded: SyncCycleTelemetryDegradedTier;  // key 2, required by the bridge
  readonly trigger_source: SyncRuntimeTriggerSource;
  // ...unchanged
}

// src/infrastructure/api/bridge-client/bridge-client.types.ts
export interface BridgeHttpResult {
  readonly ok: boolean;
  readonly status: number;
  readonly data: unknown;
  readonly rawBody: string | null;
  readonly url: string;
  readonly retryAfterMs: number | null;   // null = absent or unparseable
}

export interface BridgeClient {
  // ...existing
  readonly postSyncDiagnostics: (
    connection: BridgeConnection,
    envelope: unknown,
    options?: BridgeRequestOptions,
  ) => Promise<BridgeHttpResult>;
}

// src/infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox.types.ts
// Storage only. It never learns what an HTTP status means -- the same refusal the checkpoint
// store makes about `SYNC_CYCLE_STAGES`.
export interface SyncDiagnosticsOutboxStore {
  readonly enqueue: (entry: SyncDiagnosticsOutboxEntry) => void;
  readonly readFlushCandidates: (limit: number, now: number)
    => readonly SyncDiagnosticsOutboxRecord[];
  readonly remove: (cycleId: string) => void;
  readonly deferUntil: (notBefore: number) => void;
  readonly getFailedWriteCount: () => number;
}
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit — pure | `parseRetryAfterMs` across every row of Decision 2's table | Table-driven; injected `now` |
| Unit — pure | `capWireSyncCycleTelemetry` tier per shed level; `degraded` is the 2nd key of `JSON.stringify` output | Direct assertion on the serialized string, not on the object |
| Unit — store | Enqueue/read/remove; eviction at exactly 100 and 101; `DO NOTHING` on a repeated `cycle_id`; gate shut → `[]` | `tests/support/sqlite-adapter.helpers.ts`, real SQLite, mirroring `sync-cycle-checkpoint.helpers.test.ts` |
| Unit — store | The write path does **not** go through `withLocalWrite` | Assert the module is never invoked while the store writes |
| Unit — adapter | `postSyncDiagnostics` path, bearer, timeout override; `retryAfterMs` populated from a 503; a header-less double does not throw | `dependencies.fetchFn` injection, as `bridge-client.test.ts` does |
| Unit — flush | Each disposition (2xx/4xx/5xx/throw); stop-at-first-failure; a shut gate issues zero POSTs | Fake store + fake client |
| Unit — constants | The row-3 timing chain | Pure comparison over the real constants |
| Integration | A throwing `bridgeClient.reconcile` still leaves a durable row; a throwing flush never reaches `revertPendingOperationsOnFailure` | Extend `tests/features/sync/reconcile.helpers.test.ts` |
| Behaviour | Queue a row under a faked failing bridge, drain it on a second cycle under a faked success | `tests/behaviour/sync/diagnostics-outbox-round-trip.behaviour.test.ts`; real SQLite, real drizzle, real write door, real `bridgeClient`, only `fetch` faked |

**Regression floor is re-measured with `npm test` at task time.** Existing artifacts disagree (109/654 vs 142/953); neither is hardcoded.

### Mandatory mutation cycles (constraint 9 — stage first, then mutate)

`git add <file>` while green → delete the guard → `bunx jest <path> -t "<name>"` → confirm RED → `git checkout -- <file>`. Never `git add` after mutating; never `git checkout HEAD --` while the feature is uncommitted.

| # | Guard to delete | Test that must go RED |
|---|---|---|
| 1 | The `> ${MAX}` trigger condition (or the whole trigger) | Eviction at the exact 100/101 boundary |
| 2 | The `WHERE COALESCE(... not_before ...) <= ?` gate clause | Gate-shut-issues-no-POST — **proves the backoff is a clock comparison and not a timer** |
| 3 | The `remove()` call on the 4xx branch | Poison-pill test: a 400 row must not survive to a second flush |
| 4 | The `break` after a transient failure | Stop-at-first-failure: exactly one POST on a dead link |
| 5 | The capture call before the `try` (or move it inside) | A throwing `reconcile` still leaves a row — the change's headline inversion |
| 6 | `ON CONFLICT(cycle_id) DO NOTHING` → `DO UPDATE` | Rerun-loop test: `created_at` must not churn |
| 7 | The strict `/^\d+$/` delta-seconds branch, forcing `Date.parse` first | `"2000"` must be 2 000 000 ms, not a year-2000 date |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.`

The one arguable row is **new outbound network egress**: a second endpoint on an already-paired, already-authenticated bridge on the LAN. It introduces no new host, scheme, or credential — the connection tuple and bearer are the ones `reconcile` already uses, and the URL is built by `buildBridgeUrl`, so feature code never constructs it (Bridge Boundary rule). Payload content is unchanged: it is byte-identical to the `client_telemetry` the reconcile body already carries, already sanitized by the normalizers `resolveClientTelemetry` funnels through. Bounded by the 3 s request timeout and the 3-row batch rather than by a threat-matrix task.

## Migration / Rollout

No migration. Both tables are created inline on connect in a file documented as having none, and neither is read by anything but its own flush path.

**Rollback**: `git revert` the commits. The reconcile path is **byte-identical to today** afterwards, and this is a structural property rather than a hope:

- `client_telemetry` never left the reconcile body (dual-write), so delivery is unchanged whether the new endpoint exists or not.
- The only edits inside `performSyncPendingOperations` are two statements placed *before* an untouched `try` block; removing them restores the original control flow exactly.
- `degraded` is an added key on an object the bridge stores raw. Its absence after a revert is the pre-change contract.
- Per the proposal: **leave `sync_diagnostics_outbox` in place if it already exists.** Dropping a table in `autoreas-telemetry.db` is the riskier operation, and an unread table is inert.

## Slice Plan

~1266 authored lines against an 800-line review budget. `400-line budget risk: High`. `800-line budget risk: High`. Slices are **local commits merged to `main`** — no PRs, no push, no deploy.

The seam is the architectural boundary itself: infrastructure knows nothing about the feature, so it ships first and alone.

- **Slice A — infrastructure (~599 lines).** `src/infrastructure/db/sync-diagnostics-outbox/**`, the four bridge-client files plus barrels, `tests/support/fake-bridge.*`, and their tests. Touches **zero** files under `src/features/**`; the reconcile path is untouched and the app behaves exactly as today. Independently verifiable, independently revertable.
- **Slice B — feature wiring (~667 lines).** `degraded` on the wire type, `sync-diagnostics-flush.*`, the two calls in `reconcile.helpers.ts`, the integration and behaviour tests. Depends on A for the store and `postSyncDiagnostics`.

Slice A ships an adapter method with no production caller. That surface is expected to be hidden from the `fallow` dead-code audit by the barrel `ignoreExports` rule — **verify at apply time**, because the pre-commit audit exits 1 on a finding.

## Open Questions

- [ ] None blocking. Three apply-time verifications: (1) confirm `execSync` accepts the multi-statement `DROP TRIGGER` + `CREATE TRIGGER ... BEGIN ... END` block under the installed `expo-sqlite`; (2) confirm the Slice A adapter method does not trip the `fallow` audit before committing it; (3) re-measure the regression floor with `npm test` rather than trusting either recorded figure.
- [ ] Bridge `POST /api/sync/diagnostics` is contractually agreed but **not implemented**. Every flush will 404 or fail until it ships — bounded by design: a 4xx drops the row, so an unbuilt endpoint drains the queue rather than wedging it. **Worth confirming with bridge before apply**: if the endpoint returns 404 while unbuilt, mobile will silently discard envelopes it could otherwise have kept. Consider whether `404` should be treated as transient (leave queued) rather than permanent, as the single exception to Decision 4's taxonomy.
