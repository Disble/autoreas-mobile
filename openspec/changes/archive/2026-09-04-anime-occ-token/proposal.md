# Proposal: Anime OCC Token

## Intent

The bridge already implements optimistic concurrency on anime mutations: each reconcile operation may carry a `base` token that the bridge compares with an exact `!=` against its stored `modified_at`. **Mobile never sends `base`, so OCC is inert and concurrent edits silently last-write-wins.** The phone and the PC can both move `nrocapvisto` and the loser is decided by arrival order, with no signal to either side.

Mobile cannot start sending `base` today because it does not *have* the token. Zod's default strip mode discards `modified_at` at every parse boundary: `WireAnimeSchema` (`src/infrastructure/validation/anime-schema/anime.schema.ts:100-121`) is a plain `z.object()`, so the field is dropped by `WireAnimeListSchema` (`:127`) → `AnimeListSchema` (`src/features/sync/initial-sync.schema.ts:6`) and by `ReconcileAnimeChangeSchema.snapshot` (`src/features/sync/reconcile.schema.ts:13`). `ReconcileAppliedOperationSchema` (`reconcile.schema.ts:19-23`) has no such field at all.

This change makes mobile a correct OCC participant: ingest the token, persist it, and — once the bridge's side ships — emit it per operation and handle rejection.

## Scope

### In Scope

**Part 1 — ingest and persist (deliverable now, invisible to the bridge)**

- New nullable `animes.bridge_modified_at` column, migration `0011_*` (`EXPECTED_SCHEMA_READINESS_VERSION` → 12), plus an idempotent `ensure*` twin in `client.helpers.ts`.
- `modified_at` added to `WireAnimeSchema` and to `ReconcileAppliedOperationSchema` as `z.number().int()`.
- The **net-new write-back path** from a confirmed `applied_operations[]` entry into the `animes` row. Today `applied_operations` only flips `operation_log.status` (`reconcile.helpers.ts:102-161, 407-419, 452-464`); the only channel that currently reaches `animes` is `bridge_changes` → `applyRemoteChanges`.
- Token capture on the initial-sync ingest path (`listAnimes` emits it today, top-level per record, always present).
- Part 1 emits nothing, so the one-operation-per-anime batching rule is **Part 2 scope**. It is flagged here only so the spec phase sizes the `readOperationLogBacklog` selection change against Part 2 and does not discover it late.

**Part 2 — emit and reconcile conflicts (BLOCKED, see Delivery Ordering)**

- `buildReconcileRequestBody` (`reconcile.helpers.ts:62-79`) emits `base` per operation.
- **At most one operation per `anime_id` per batch.** This is a selection change in `readOperationLogBacklog` (`operation-log-retention.helpers.ts:86-110`), whose query is today a flat `ORDER BY created_at ASC, id ASC LIMIT ?` with no per-anime grouping. The dedup must keep the **oldest** row per `anime_id` (per-anime FIFO is not optional — `op3` must never precede `op1`) and must apply **before** the `LIMIT`, otherwise the batch silently shrinks below its bound. Note the semantic shift: `limit` comes to bound distinct animes rather than rows. The exact SQL form is design-phase work. The existing docstring already anticipates this — "the query always orders by age so future reconcile batching can continue incrementally".
- `ReconcileAppliedOperationSchema` grows `modified_at: z.number().int().optional()` and `reason: z.string().optional()`, where `reason` is a closed two-member vocabulary — `unsupported_operation` (permanent) and `conflict` (recoverable) — absent whenever `applied: true`.
- Conflict handling: re-base from the `modified_at` carried on that same entry, bounded retry, explicit terminal state.

### Out of Scope

- Any use of `bridge_changes[].snapshot.modified_at` (hardcoded `0` on the bridge — see Invariants).
- The response `conflicts` array: dead scaffolding, typed `[]any`, hardcoded empty, never populated. Treated as `unknown[]`, never read, never typed against. The bridge team **declined to populate it and is deprecating it in the openapi** — populating it would express the same fact in two shapes, which is how a client handles one and ignores the other. It will be removed in its own announced change.
- Any dependency on a conflict identifier. The bridge **declined to expose `ConflictID`**: recovery is fully determined by `reason: "conflict"` plus `modified_at`, and the ID is the primary key of a bridge-internal table reachable only from their admin endpoint. Cheap to add later, expensive to remove. Decided, not open.
- Any change to `lastAppliedChangeMs` (`database.schema.ts:32`) semantics.
- The migration-0010 non-application defect — a separate in-flight fix owns it.

## Capabilities

### New Capabilities
- `anime-optimistic-concurrency`: mobile ingests, persists, and emits the bridge's `modified_at` token per anime, and resolves a rejected write by re-basing with a bounded retry and an explicit terminal state.

### Modified Capabilities
- None.

## Approach

### Decision 1 — the token lives on `animes`, not on `operation_log`

Recommended: a nullable column on `animes`, parallel to `lastAppliedChangeMs`, resolved by a SELECT at send time.

Capture-at-enqueue on `operation_log` looks free — `applyAnimeMutationPatch` (`anime-mutation.helpers.ts:237-267`) already holds the row inside its transaction — but it is not, and it is **wrong**. `fetchParsedAnime` (`:247`) returns the parsed domain `Anime`, which by invariant must not carry the token, so enqueue capture still costs a dedicated column read. Worse: the local token only advances when the bridge confirms a write, so an operation enqueued *before* an earlier reconcile confirmed its predecessor would carry a token the device itself has already superseded, and the bridge would reject **our own pipeline's ordered write** as a conflict. OCC must guard against foreign writers, not against the device's own confirmed history.

The genuine weakness of the row-level token — two queued operations for the same anime in one batch carrying the identical `base`, where the first moves `modified_at` and invalidates the second — is not solved by per-operation storage either; both were captured before either was applied. It is solved by **sending at most one operation per `anime_id` per reconcile batch**. Operations behind it wait for the next cycle, by which time the token has advanced from that batch's own `applied_operations` entry and they carry a fresh, valid `base`.

**Why not coalesce instead** (only the first operation per anime carries `base`, the rest omit it): that justification holds only when the first operation *succeeds*, and the rejection path is exactly the case OCC exists for.

1. A foreign writer moves anime X on the bridge. Our token is stale.
2. Our batch carries `op1(X)` with the stale `base`, then `op2(X)` and `op3(X)` with the key omitted.
3. `op1` is rejected with `reason: "conflict"`. The guard did its job.
4. A conflict is **non-fatal** — the batch continues at 202 and every operation we sent gets an entry.
5. `op2` and `op3` carry no `base`. Omission is the intentional OCC bypass, so the bridge applies them last-write-wins — **destroying precisely the foreign change `op1` just refused.**

That is strictly worse than sending no `base` at all: without OCC we lose the foreign change and know it; under coalescing we lose it while the response reports that we were protected. It is also unrepairable on the client — by the time we read `reason: "conflict"` on `op1`, `op2` and `op3` are already committed server-side, and neither re-queuing nor a local rollback un-writes the bridge.

Two alternatives were considered and **rejected**: keeping coalescing and re-queuing the whole group on conflict (the damage is already committed server-side), and asking the bridge to apply per-anime groups atomically (their contract is closed, and it pushes our batching concern into their transaction boundary).

The cost is latency — N queued edits to one anime take N cycles — against a case that already requires multiple edits to the same anime between two reconciles, using the same sync-interval backoff Decision 2 relies on. Correctness over latency; it is the only option that actually prevents the write.

The case against per-operation token storage holds **more** strongly under this rule than it did under coalescing: only one operation per anime is ever in flight carrying a token, so a column on the write-heavy `operation_log` plus the threading through `OperationLogRow` and `buildReconcileRequestBody` is pure cost.

`upsertAnime` already takes an optional out-of-band `guardMs` (`anime-repository.ts:10, 32`); the token follows that exact precedent as a second optional parameter.

### Decision 2 — bounded retry, never a loop, never a silent discard

The token returned on a conflict is the bridge's state at the instant of rejection, **not a promise the retry lands** — another writer can move it in between. Therefore:

- `reason: "unsupported_operation"` → **permanent**. Terminal immediately, no retry, no re-base.
- `reason: "conflict"` → **recoverable**. Persist the `modified_at` from that same entry to `animes`, re-queue the operation for the **next** reconcile cycle. No inner retry loop: retrying inside the same cycle re-enters the same race, and the sync interval is the natural backoff.
- Any **unrecognized** `reason` → surfaced, never classified (invariant 9).
- A per-operation attempt counter with a small cap (**3**). Exhaustion moves the row to an explicit terminal `operation_log.status` value, surfaced — never dropped. (A counter *is* genuinely per-operation state, so a column on `operation_log` is correct here; that does not reopen Decision 1.)

## Invariants

1. **Never source the token from `bridge_changes[].snapshot.modified_at`** — hardcoded `0` on the bridge. The only valid sources are `listAnimes` records and `applied_operations[]` entries.
2. **Never-seen anime → omit the `base` key entirely.** Not `null`, not `0`. `json.Unmarshal([]byte("null"), &int64)` returns no error and leaves the Go value at its zero, so `"base": null` arrives as `base: 0` — a *real* token, not a bypass. The natural JS default `{ base: token ?? null }` is exactly the bug.
3. **`0` is a legitimate token, not a sentinel.** It means "row never written through the OCC path". Measured on a real captured `listAnimes` response: 143 records, 135 at `modified_at: 0`, 8 with a real timestamp. `base: 0` against stored `0` passes the `!=` check. Those rows self-heal on first write (`intended = max(now_ms, base+1)`). Stated honestly: while a row sits at `0`, OCC is inert for it and two clients both writing `base: 0` both succeed. That is the designed transitional state, not a defect.
4. The column must be **nullable with no default**. `NULL` = "no token known" → omit `base`. `0` = a real token → send it. Collapsing them destroys invariant 2.
5. **The token is transport-and-persistence only.** It must not appear on the domain `Anime`/`AnimeSchema` (`anime.schema.ts:73-94`) or on any UI-facing list item; `mapWireAnimeToLegacyAnime` (`anime-wire.helpers.ts:8-19`) stays a 1:1 mapper. Note the cost: adding a physical column widens drizzle's inferred select type, so the repository must project it away explicitly rather than let it leak by inference.
6. `bridge_modified_at` is **not** `lastAppliedChangeMs`. The latter is a client apply-order staleness guard written from `change.timestamp` via `normalizeBridgeChange` (`reconcile.helpers.ts:309-317`), never from `modified_at`. Reusing it would produce a conflict on every write.
7. **On the response side, `modified_at: 0` and an absent key are different facts and must never collapse.** `0` means a token exists and its value is `0` — the state of 135 of our 143 rows. An absent key means no token at all (the skipped branch, which never calls the writer). The bridge uses Go `*int64` with `omitempty` precisely for this: a pointer to `0` serializes `"modified_at":0`, `nil` omits the key. A plain `int64` would have eaten the real `0`. So the field is `z.number().int().optional()`, and a `?? null` or `|| undefined` applied to it breaks the contract **exactly the way `base: token ?? null` breaks invariant 2**. This is the same trap twice in opposite directions — once writing the request, once reading the response — and it is the single most likely way this change gets implemented wrong.
8. **An operation must never be sent with `base` omitted when a token is known for that anime.** Omission is reserved for a genuinely unknown token (`NULL` column, invariant 4). This is what makes the coalescing hole unreachable *by construction* rather than by remembering: there is no code path that can produce an unguarded write for an anime whose token we hold, so no future batching optimization can reintroduce it silently.
9. **An unrecognized `reason` must be surfaced, never silently discarded and never bucketed.** The vocabulary is closed at exactly two members today; a future third cause gets its own announced value and is never folded into an existing one. A client that cannot classify permanent-versus-recoverable is guessing, and guessing "permanent" destroys the user's edit. Note the asymmetry that makes this a hard rule rather than a nicety: an unknown value has no safe default in either direction — guessing "recoverable" burns the retry budget on something that will never succeed, guessing "permanent" throws away a real edit.

## Delivery Ordering (non-negotiable)

**Part 1 changes no outbound request.** It is completely invisible to the bridge and ships independently, immediately.

**Part 2 is BLOCKED** until bridge SDD-66 ships *and* is verified, because it depends on `applied_operations[]` carrying the new post-write `modified_at` — today those entries are exactly `{anime_id, operation, applied}`. Emitting `base` before that lands would leave every local token stale after the first write, and the first real conflict would hit the current bridge behaviour: **HTTP 500 with the entire response lost** — no `applied_operations`, no `bridge_changes`, no cursor.

SDD-66 makes a conflict a **per-operation result**: the batch continues, the status stays **202**, and the response carries `last_changelog_id`, `bridge_changes`, and one entry per operation sent, in order. A genuine non-conflict error still aborts the batch as it does today — only conflict becomes non-fatal. The wire contract is now final; what remains is SDD-66's own spec, design, tasks, apply, verify and commit. The bridge team signals the green light.

The session delivery strategy is `single-pr`; the bridge dependency forces two deliveries regardless, so Part 1 is the single PR and Part 2 is a separate one gated on the bridge handover.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/infrastructure/db/schema/database.schema.ts` | Modified | Nullable `bridge_modified_at` on `animes`; Part 2 adds an attempt counter to `operation_log` |
| `drizzle/migrations/0011_*` + journal | New | Column migration; readiness version → 12 |
| `src/infrastructure/db/client.helpers.ts` | Modified | Idempotent `ensure*` twin (precedent: `0007_add_animes_last_applied_change_ms`) |
| `src/infrastructure/validation/anime-schema/anime.schema.ts` | Modified | `modified_at` on `WireAnimeSchema` only, never on `AnimeSchema` |
| `src/features/sync/reconcile.schema.ts` | Modified | `modified_at` as `z.number().int().optional()` on `ReconcileAppliedOperationSchema`; optional `reason` (Part 2) |
| `src/infrastructure/db/anime-repository.ts` | Modified | Optional token parameter following the `guardMs` precedent |
| `src/features/sync/reconcile.helpers.ts` | Modified | Net-new `applied_operations` → `animes` write-back (P1); `base` emission + one-op-per-anime batching + conflict handling (P2) |
| `src/features/sync/initial-sync.schema.ts` | Modified | Token survives the list parse |
| `src/features/sync/operation-log-retention.helpers.ts` | Modified | One row per `anime_id` (oldest), deduped before `LIMIT` (Part 2) |
| `tests/features/sync/__tests__/`, `tests/features/animes/__tests__/` | New/Modified | TDD per constraint 4; mutation pass per constraint 9 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `base: null` ships instead of key omission | **High** — it is the idiomatic JS default | Invariant 2; a dedicated test asserting the key is *absent* from serialized JSON, not that it is null |
| Part 1 cannot be validated on a real device | High | Migration 0010 is not applying, leaving background sync a silent no-op; a separate in-flight fix owns it. Part 1 must be validated by integration tests against a real database and re-validated on device once that fix lands |
| Rows migrated to `NULL` never receive a token | Medium | `listAnimes` runs on initial sync only, so existing rows stay `NULL` until their first confirmed local edit populates the column. OCC is inert for one edit per row, then active — the same self-heal shape as invariant 3 |
| `modified_at: 0` collapsed with an absent key when reading the response | **High** — `?? null` and `\|\| undefined` are both idiomatic on an optional number | Invariant 7; a test that distinguishes a parsed `0` from a parsed `undefined` on the same field |
| An unrecognized `reason` is bucketed into one of the two known members | Medium | Invariant 9; a test feeding a third value and asserting it is surfaced, not classified |
| A later batching optimization re-groups operations per anime and silently reopens the coalescing hole | Medium | Invariant 8 makes an unguarded write for a known-token anime unreachable by construction; a test asserts no batch contains two operations for the same `anime_id` |
| N queued edits to one anime now take N reconcile cycles to drain | Low | Requires multiple edits to the same anime between two reconciles; accepted deliberately as correctness over latency |
| Bridge SDD-66 refines a contract detail during its own spec/design | Low | The wire shape is final and the bridge team commits to signalling any movement; Part 2 does not enter apply before their green light |
| Token leaks into `Anime`/UI types by drizzle type inference | Medium | Invariant 5; explicit projection at the repository boundary |
| Staged files inherit `dharness` JSDoc debt | High | JSDoc written as part of each edit (constraint 12) |

## Rollback Plan

Revert the commit; **leave the column in place**. It is nullable with no default and no reader outside this change, so an orphaned column is inert. Dropping a column from a live SQLite table and rewinding `EXPECTED_SCHEMA_READINESS_VERSION` is the strictly more dangerous operation and would break readiness for every actor. Part 2 rolls back independently: removing `base` emission returns the bridge to the current last-write-wins behaviour without touching stored tokens.

## Dependencies

- **Part 2 only** — bridge SDD-66 must ship and be verified. The wire contract below is final; the dependency is on their implementation landing, not on further contract negotiation.
- The migration-0010 fix, for on-device validation of Part 1 (not for its implementation).

## Bridge Contract (final — no open wire items)

```json
"applied_operations": [
  {"anime_id":"...","operation":"update","applied":true,"modified_at":1788540735366},
  {"anime_id":"...","operation":"update","applied":false,"reason":"conflict","modified_at":1788540735366},
  {"anime_id":"...","operation":"delete","applied":false,"reason":"unsupported_operation"}
]
```

- **`modified_at`** — Go `*int64` with `omitempty`. Present whenever a token exists; the key is **omitted entirely** when there is none. See invariant 7.
- **`reason`** — closed vocabulary, exactly two members: `unsupported_operation` (permanent, discard) and `conflict` (recoverable, re-base on the same entry's `modified_at` and retry). **Absent when `applied: true`** — there is deliberately no "none" member, because `applied: true` already carries that fact and a no-information member would force every client to handle it. See invariant 9 for unrecognized values.

Declined by the bridge team and recorded as **decided, not open**: `conflicts []` stays empty and is being deprecated in the openapi; `ConflictID` is not exposed. Both are covered under Out of Scope.

## Success Criteria

- [ ] `modified_at` survives every parse boundary it enters and reaches `animes.bridge_modified_at`.
- [ ] A confirmed `applied_operations[]` entry writes its token back to the `animes` row — a path that does not exist today.
- [ ] A never-seen anime produces a request body whose serialized JSON **omits** the `base` key; asserted on the bytes, not on the object.
- [ ] `base: 0` is emitted for a row whose stored token is `0`, and is never conflated with "no token".
- [ ] `bridge_changes[].snapshot.modified_at` is never read as a token source; asserted by test.
- [ ] `Anime`, `AnimeSchema`, and UI-facing list types are byte-identical in shape to before the change.
- [ ] A response entry with `modified_at: 0` and one with the key absent produce **distinguishable** parsed results; neither is normalized into the other.
- [ ] An `applied_operations[]` entry with an unrecognized `reason` is surfaced, not classified as either known member.
- [ ] At most one operation per `anime_id` is sent per batch.
- [ ] A reconcile request body never contains two operations for the same `anime_id`, asserted directly on the built body.
- [ ] No operation is ever sent with `base` omitted while a token is known for that anime.
- [ ] A `conflict` entry re-bases from its own `modified_at`, retries at most 3 times, then lands in an explicit terminal state — never a silent discard. An `unsupported_operation` entry goes terminal on the first response, with no retry.
- [ ] Schema readiness version is 12 and the `ensure*` twin makes the column present on an already-installed device.
- [ ] Regression floor holds: the full suite green.
