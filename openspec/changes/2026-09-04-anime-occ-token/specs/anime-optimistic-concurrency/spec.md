# Anime Optimistic Concurrency Specification

## Purpose

Mobile becomes a correct optimistic-concurrency participant on anime mutations: it ingests and persists the bridge's `modified_at` token (Part 1, ships independently, invisible to the bridge), then emits it per operation and resolves rejection (Part 2, gated on bridge SDD-66). Part 1 requirements are independently satisfiable — none depends on emitting `base` or on conflict handling.

## Requirements

### Requirement: Bridge Modified-At Column Persisted via Migration and Ensure Twin

The system MUST add a nullable `bridge_modified_at` column with no default to `animes` (`database.schema.ts`), created by both a new migration (`0011_*`) and an idempotent `ensure*` twin in `client.helpers.ts` (precedent: `0007_add_animes_last_applied_change_ms`), because the drizzle migrator compares only the max recorded `created_at` and silently skips already-installed devices.

#### Scenario: Fresh install runs the migration

- GIVEN a device with no prior schema
- WHEN migrations run
- THEN `animes.bridge_modified_at` exists, nullable, no default

#### Scenario: Already-installed device is repaired by the ensure twin

- GIVEN a device whose migration history already reports `0011_*` applied but the column is absent
- WHEN the `ensure*` twin runs
- THEN `animes.bridge_modified_at` exists afterward

#### Scenario: A freshly migrated row has NULL, not 0

- GIVEN a row inserted after migration with no explicit token
- WHEN the row is read
- THEN `bridge_modified_at` is `NULL`, not `0`

### Requirement: Schema Readiness Validates the Column, Not Just the Table

`EXPECTED_SCHEMA_READINESS_VERSION` MUST become 12, and readiness validation MUST verify `animes.bridge_modified_at` exists as a column, not only that `animes` exists — this SQLite build compiles with `SQLITE_DQS=3`, so a query naming a missing column degrades silently to a string literal instead of erroring, and a `WHERE` on it stops filtering with no error.

#### Scenario: Readiness fails when the table exists but the column is missing

- GIVEN `animes` exists but `bridge_modified_at` does not
- WHEN readiness validation runs
- THEN it reports not-ready

#### Scenario: Readiness passes at version 12 with the column present

- GIVEN the column exists and the recorded schema version is 12
- WHEN readiness validation runs
- THEN it reports ready

### Requirement: Token Survives the Initial-Sync Parse Boundary

`modified_at` MUST be added to `WireAnimeSchema` (`anime.schema.ts:100-121`) and MUST survive `WireAnimeListSchema` (`:127`) and `AnimeListSchema` (`initial-sync.schema.ts:6`) into persisted `animes.bridge_modified_at`, since Zod's default strip mode discards any field not declared on the object schema.

#### Scenario: A listAnimes record's token reaches storage

- GIVEN a `listAnimes` wire record with `modified_at: 1788540735366`
- WHEN it is parsed and persisted
- THEN stored `animes.bridge_modified_at` for that anime equals `1788540735366`

#### Scenario: A zero token is not stripped as falsy

- GIVEN a wire record with `modified_at: 0`
- WHEN it is parsed
- THEN the parsed value is exactly `0`, not dropped or replaced

### Requirement: Token Never Reaches Domain or UI-Facing Types

`bridge_modified_at` MUST NOT appear on the domain `Anime`/`AnimeSchema` (`anime.schema.ts:73-94`) or any UI-facing list item type. The repository MUST project the column away explicitly at the boundary; `mapWireAnimeToLegacyAnime` (`anime-wire.helpers.ts:8-19`) stays a 1:1 mapper.

#### Scenario: Domain shape is unchanged

- GIVEN the `Anime`/`AnimeSchema` shapes before this change
- WHEN compared to the shapes after this change
- THEN they are byte-identical

#### Scenario: A row read that selects the column does not leak it

- GIVEN a repository read that internally selects `bridge_modified_at`
- WHEN it returns an `Anime`/list item to a caller
- THEN the returned object has no token field

### Requirement: Token Is Independent of the Apply-Order Staleness Guard

`bridge_modified_at` MUST remain distinct from `lastAppliedChangeMs` (`database.schema.ts:32`) and MUST NOT be derived from `change.timestamp` via `normalizeBridgeChange` (`reconcile.helpers.ts:309-317`).

#### Scenario: Writing the token does not alter the staleness guard

- GIVEN a row with an existing `lastAppliedChangeMs`
- WHEN `bridge_modified_at` is written for that row
- THEN `lastAppliedChangeMs` is unchanged

### Requirement: Token Source Restricted to listAnimes and Applied-Operations

The system MUST NOT read `bridge_changes[].snapshot.modified_at` as a token source — it is hardcoded to `0` on the bridge. The only valid sources are `listAnimes` records and `applied_operations[]` entries.

#### Scenario: A snapshot's modified_at is ignored

- GIVEN a `bridge_changes[]` entry whose `snapshot.modified_at` is `0` while the anime's real stored token is nonzero
- WHEN that change is applied via `applyRemoteChanges`
- THEN `animes.bridge_modified_at` is not overwritten from the snapshot value

### Requirement: Parsed Applied-Operation Token Distinguishes Zero From Absent

`ReconcileAppliedOperationSchema.modified_at` (`reconcile.schema.ts:19-23`) MUST be `z.number().int().optional()`. Parsing an entry with `modified_at: 0` and parsing an entry with the key absent MUST produce distinguishable results; neither may collapse into the other via `?? undefined`/`|| undefined`-equivalent handling.

#### Scenario: A parsed zero is not undefined

- GIVEN an entry `{ applied: true, modified_at: 0 }`
- WHEN it is parsed
- THEN the parsed `modified_at` is exactly `0`

#### Scenario: An absent key parses as absent, not zero

- GIVEN an entry `{ applied: true }` with no `modified_at` key
- WHEN it is parsed
- THEN the parsed `modified_at` is `undefined`, distinguishable from a parsed `0`

### Requirement: Confirmed Write-Back Updates the Stored Token Only When One Is Present

When a confirmed (`applied: true`) `applied_operations[]` entry carries a `modified_at`, the system MUST write it back to `animes.bridge_modified_at` for the matching `anime_id` — a path that does not exist today (`applied_operations` currently only flips `operation_log.status`, `reconcile.helpers.ts:102-161, 407-419, 452-464`). When the entry has no `modified_at`, the stored token MUST be left unchanged.

#### Scenario: A nonzero confirmed token is written back

- GIVEN an entry `{ anime_id: X, applied: true, modified_at: 1788540735366 }`
- WHEN applied_operations is processed
- THEN `animes.bridge_modified_at` for X becomes `1788540735366`

#### Scenario: A confirmed zero token is written back, not skipped

- GIVEN an entry `{ anime_id: X, applied: true, modified_at: 0 }`
- WHEN applied_operations is processed
- THEN `animes.bridge_modified_at` for X becomes `0`

#### Scenario: An absent token leaves the stored value untouched

- GIVEN an entry `{ anime_id: X, applied: true }` with no `modified_at`
- WHEN applied_operations is processed
- THEN `animes.bridge_modified_at` for X is unchanged from its prior value

### Requirement: Request Body Never Manufactures or Loses a Base Token

`buildReconcileRequestBody` (`reconcile.helpers.ts:62-79`) MUST emit `base` for an operation only when a token is known (column not `NULL`) for that `anime_id`, and MUST omit the `base` key entirely — not `null` — when the token is unknown. A known token of `0` MUST be emitted as `base: 0`; no known token may ever be omitted.

#### Scenario: Unknown token omits the key from serialized bytes

- GIVEN an anime whose `bridge_modified_at` is `NULL`
- WHEN its operation is serialized into the request body
- THEN the serialized JSON bytes contain no `base` key for that operation

#### Scenario: A known zero token is emitted, not omitted

- GIVEN an anime whose `bridge_modified_at` is `0`
- WHEN its operation is serialized
- THEN the serialized JSON bytes contain `"base":0` for that operation

#### Scenario: A known nonzero token is always sent

- GIVEN an anime whose `bridge_modified_at` is a nonzero value
- WHEN its operation is serialized
- THEN the serialized JSON bytes contain `"base"` set to that value

### Requirement: At Most One Operation Per Anime Per Batch

`readOperationLogBacklog` (`operation-log-retention.helpers.ts:86-110`) MUST select at most one queued operation per `anime_id` per batch — the oldest by `created_at`/`id` — and MUST apply this dedup before `LIMIT`, so `limit` bounds distinct animes rather than rows.

#### Scenario: Two queued operations for the same anime yield one in the batch

- GIVEN `op1` and `op2` target the same `anime_id`, `op1` older
- WHEN the batch is selected
- THEN only `op1` is included

#### Scenario: Per-anime FIFO holds across a third operation

- GIVEN `op1`, `op2`, `op3` for the same `anime_id` in that creation order
- WHEN batches are selected across successive cycles
- THEN `op3` never precedes `op1`

#### Scenario: Dedup does not shrink the batch below its bound

- GIVEN a `LIMIT` of N and more than N distinct animes with queued operations, some with duplicate queued operations
- WHEN the batch is selected
- THEN it contains N distinct-anime operations, not fewer

### Requirement: Unrecognized Reason Is Surfaced, Never Classified

When an `applied_operations[]` entry carries a `reason` outside the closed vocabulary (`unsupported_operation`, `conflict`), the system MUST surface it rather than treat it as either known member.

#### Scenario: A third reason value is not bucketed

- GIVEN an entry `{ applied: false, reason: "some_future_value" }`
- WHEN it is processed
- THEN it is surfaced as unrecognized, neither retried as `conflict` nor discarded as `unsupported_operation`

### Requirement: Unsupported Operation Is Terminal With No Retry

When an entry carries `reason: "unsupported_operation"`, the system MUST mark that operation's `operation_log` row terminal on the first response, with no re-base and no retry.

#### Scenario: A first unsupported_operation response ends the operation

- GIVEN an entry `{ applied: false, reason: "unsupported_operation" }`
- WHEN it is processed
- THEN `operation_log.status` becomes terminal immediately and the operation is never re-queued

### Requirement: Conflict Re-Bases, Re-Queues for the Next Cycle, and Terminates After 3 Attempts

When an entry carries `reason: "conflict"`, the system MUST persist that entry's own `modified_at` to `animes.bridge_modified_at` and re-queue the operation for the next reconcile cycle — never an inner retry within the same cycle. A per-operation attempt counter capped at 3 MUST move the row to an explicit terminal `operation_log.status` on exhaustion, surfaced rather than silently discarded.

#### Scenario: A conflict re-bases and re-queues, not retries inline

- GIVEN an entry `{ applied: false, reason: "conflict", modified_at: 1788540735366 }`
- WHEN it is processed
- THEN `animes.bridge_modified_at` becomes `1788540735366`, and the operation is queued for the next cycle, not retried within the current one

#### Scenario: A third consecutive conflict reaches terminal state

- GIVEN an operation already received `conflict` responses on 2 prior cycles
- WHEN a 3rd `conflict` response is received
- THEN the operation reaches an explicit terminal `operation_log.status`, surfaced, not silently discarded

#### Scenario: A conflict that advances the token does not consume the budget

- GIVEN an operation whose stored `bridge_modified_at` is `T`
- AND a `conflict` entry returns a `modified_at` of `T'` where `T' != T`
- WHEN the operation is re-based and re-queued
- THEN the attempt counter is reset, not incremented

The budget exists to stop a losing race, not to punish a stale token. A conflict
that hands back a NEW token is progress: the next attempt carries information the
previous one did not. Only a conflict that returns the SAME token the operation
already holds means no progress was made, and only that increments the counter.

Without this rule the counter terminalises healthy operations after a transient
bridge fault. A non-conflict error still aborts the batch and returns HTTP 500
with no body (`sync_handler.go:192` — only conflict was made non-fatal), so the
operations BEFORE the failure were applied on the bridge but their
`applied_operations` never reached the client, leaving their tokens stale. The
next cycle then produces a legitimate conflict that nobody caused. Counting that
against a cap of 3 lets a flaky bridge terminalise correct work in three cycles.

### Requirement: A Stalled Operation Becomes Visible, Not Terminal

An operation that keeps conflicting with a token that ADVANCES each time is
losing a race, not failing. It is doing exactly what OCC asks, so it MUST NOT be
terminalised — terminalising discards a user edit that never failed on its own
merit. But it MUST NOT stay invisible either. After a bounded number of cycles
without landing, the system MUST surface it.

#### Scenario: An operation that never lands becomes visible

- GIVEN an operation that has been re-based and re-queued for a visibility
  threshold of consecutive cycles without ever being applied
- WHEN the threshold is crossed
- THEN the operation is surfaced as stalled, and it REMAINS queued and continues
  to retry

The reasoning that rejects terminalising applies with equal force to the state it
would otherwise be sent to. An operation retrying forever with nobody aware is
also lost silently — a queue that never drains rather than a terminal row nobody
reads. At a 15-minute cycle that is 96 attempts a day for an edit that never
lands, and from where the user stands the two outcomes are indistinguishable:
their change is not there.

So the bound belongs on the SILENCE, not on the retrying. Retry stays unbounded
because it is correct; visibility gets a threshold, and that threshold can be far
higher than the no-progress cap, because its cost is a notice rather than a
discarded edit.

This is the same rule already applied to an unrecognised `reason` and to a
conflict entry missing its token: do not discard it, do not guess at it, make it
visible. The failure was never the problem — the failure looking green was.

### Requirement: A Conflict Entry Without a Token Is a Contract Violation, Not a Default

The bridge always returns `modified_at` on a `conflict` entry — `recordConflict`
returns `current.ModifiedAt` unconditionally — but the schema types it
`optional()` because the skipped branch legitimately omits it. That leaves
TypeScript with an `undefined` that cannot occur on this branch. The system MUST
treat its absence as a loud failure and MUST NOT substitute a default.

#### Scenario: A conflict entry missing its token fails loudly

- GIVEN an entry `{ applied: false, reason: "conflict" }` with no `modified_at`
- WHEN it is processed
- THEN the operation is surfaced as an unprocessable contract violation, and
  `animes.bridge_modified_at` is left untouched

A `?? 0` here would be the token trap a third time, in the one place the other
two requirements do not reach: it would write `0` — a real, legitimate token —
over a column whose true value is unknown, and the next cycle would send that
`0` as `base` with full confidence. Requirement "Parsed Applied-Operation Token
Distinguishes Zero From Absent" governs parsing; this one governs what happens
when a branch invariant is violated anyway.
