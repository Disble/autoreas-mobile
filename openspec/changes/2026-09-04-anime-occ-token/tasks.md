# Tasks: Anime OCC Token

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Slice 0 ~390, Part 1 ~590, Part 2 ~635 (design.md File Changes) |
| 400-line budget risk | High for Part 1 and Part 2 against the default 400-line guard (design.md "Review budget forecast"). Slice 0 is a self-contained zero-behaviour commit and is not itself a review-budget risk |
| Chained PRs recommended | Yes — Part 1 and Part 2 are separate deliveries by design (proposal.md "Delivery Ordering"); Part 1 may optionally split further at the P1-a / P1-b seam design.md proposes |
| Suggested split | Slice 0 (own commit, lands first) → Part 1 (single delivery) → [bridge SDD-66 gate] → Part 2 (separate delivery) |
| Delivery strategy | `single-pr` for Part 1 per the session's delivery strategy; Part 2 is necessarily a second, separately gated delivery |
| Chain strategy | sequential: Slice 0 → Part 1 → bridge SDD-66 ships and is verified → Part 2 |

Decision needed before apply: No — delivery ordering is decided in proposal.md and not re-opened here.
Chained PRs recommended: Yes, see above.
400-line budget risk: High (Part 1, Part 2).

### Suggested Work Units

| Unit | Goal | Delivery | Focused test command | Spec requirements | Rollback boundary |
|------|------|----------|-----------------------|--------------------|--------------------|
| Slice 0 | Zero-behaviour extraction of `reconcile.helpers.ts` (493/500 lines, forced by Part 1 + Part 2 growth) | own commit, lands before any OCC work | `bun run test -- tests/features/sync` (no assertion edits expected) | none — prerequisite | `git revert`; pure move, nothing to unwind |
| Part 1 | Ingest and persist the token; nothing on the wire | independent delivery | `bun run test -- tests/features/sync tests/features/animes tests/infrastructure/db tests/infrastructure/validation` | 1–8 | `git revert`; column stays in place per proposal Rollback Plan |
| Part 2 | Emit `base`, batch dedup, conflict handling | separate delivery, BLOCKED on bridge SDD-66 | `bun run test -- tests/features/sync tests/infrastructure/db` | 9–13 | `git revert`; removing `base` emission returns to today's last-write-wins |

---

## General Notes (apply throughout)

### Complexity Budget Note

`bun run audit` runs a `new-only` gate that blocks on complexity a change *introduces* (measured: blocks at `complexity_introduced >= 1`). `reconcile.helpers.ts` and `sync-runtime-status.helpers.ts` are both already near their limits. Any task in this list that grows a function past its threshold owes its own extraction **in that same task** — do not defer it to the regression-gate phase.

### Mutation Protocol Note (applies to every MUTATE step below)

Stage first, then mutate: (1) `git add <file>` while the feature is still green — the index now holds the feature WITHOUT the mutation; (2) delete the guard the test claims to cover; (3) run only that test (`bunx jest <path> -t "<name>"`) and confirm it fails; (4) `git checkout -- <file>`, which restores from the index. Never `git add` after mutating. Never `git checkout HEAD -- <file>` or `git restore <file> --source=HEAD` while the feature is uncommitted — both restore from HEAD and delete the whole uncommitted feature, not just the mutation.

**Unsafe against concurrent staging.** The git index is global to the working tree. Do not run a mutation check while another actor in the same working tree is running `git add -A` (or any other staging command) — a concurrent stage can capture the mutation into the index, or overwrite the pre-mutation snapshot the restore step depends on. Coordinate exclusive access to the index before step 1.

---

## Phase 0 — Slice 0: Zero-Behaviour Extraction of `reconcile.helpers.ts`

**Must be its own commit, before any OCC-related edit touches this file.** Design Decision 8: the file measures 493/500 lines; Part 1 adds ~5, Part 2 adds ~40 — the split is forced, not optional. Behaviour does not change in this phase; the full suite must stay green with no test edits beyond import paths.

- [x] 0.1 Create `src/features/sync/reconcile-request.helpers.ts`: move `buildReconcileRequestBody` (`reconcile.helpers.ts:62-79`), `normalizePendingOperationPayload` (`:85-96`), `parseOperationPayload` (`:169-181`), `normalizeLegacyAnimeUpdatePayloadAliases` (`:189-214`) verbatim.
- [x] 0.2 Create `src/features/sync/reconcile-confirmation.helpers.ts`: move `getConfirmedOperationIds` (`reconcile.helpers.ts:102-116`), `isOperationConfirmed` (`:126-161`) verbatim.
- [x] 0.3 Update `src/features/sync/reconcile.helpers.ts`: remove the moved bodies; import the moved functions where `syncPendingOperations` still needs them. No re-export barrel (design.md: a partial barrel would hide where the code actually lives).
- [x] 0.4 Retarget import paths only (no assertion changes) in `tests/features/sync/reconcile-request-body.test.ts`, `tests/features/sync/reconcile-pending-operation-payload.helpers.test.ts`, `tests/features/sync/reconcile.helpers.test.ts`.
- [x] 0.5 Retarget every other importer of the moved symbols to the new module paths: `anime-mutation.helpers.ts`, `use-reconcile.ts`, `headless-sync-cycle.helpers.ts`, and any remaining test files that import them directly. (Verified: all three only import `syncPendingOperations`, which was not moved — no edit needed. No other file imports the moved symbols.)
- [x] 0.6 Run the full sync + animes suite: every test passes with only import-path diffs, zero assertion changes. Confirm `reconcile.helpers.ts` drops from ~493 to ~290 lines. (Verified: 134/134 suites, 848/848 tests green; `reconcile.helpers.ts` is 317 lines, `reconcile-request.helpers.ts` is 110, `reconcile-confirmation.helpers.ts` is 68 — all under the 500-line ceiling.)
- [x] 0.7 JSDoc pass on both new modules and on any exported symbol left undocumented in `reconcile.helpers.ts` after the split (the whole staged file is linted, not just the diff). (Verified: `eslint --max-warnings=0` clean on all 3 touched src files + 3 touched test files.)

**Commit boundary: Slice 0 lands alone before Phase 1 starts.**

---

## Part 1 — Ingest and Persist the Token

Independently shippable and verifiable with nothing emitted on the wire. Satisfies spec requirements 1–8.

### Phase 1 — Schema, Migration, Ensure Twin, Column-Level Readiness (Requirements 1, 2)

`SQLITE_DQS=3` is why this phase's column-level checks are the barrier, not a nicety: a `SELECT`/`WHERE` naming a missing column silently resolves to the column's own name as a string instead of erroring, on this build.

- [x] 1.1 RED extend `tests/infrastructure/db/ensure-animes-guard-column.test.ts` (or its renamed successor): asserts a fresh migration run produces `animes.bridge_modified_at`, nullable, no default; asserts the ensure-twin adds the column on a pre-0011 database and is a no-op re-run on a current one (run twice).
- [x] 1.2 RED same file: a freshly inserted row with no explicit token reads back `bridge_modified_at` as `NULL`, not `0`.
- [x] 1.3 GREEN `src/infrastructure/db/schema/database.schema.ts`: add `bridgeModifiedAt: integer('bridge_modified_at')` to `animes`, nullable, no default. JSDoc: bridge-authored, transport/persistence only (invariant 5), distinct from `lastAppliedChangeMs`.
- [x] 1.4 GREEN `src/infrastructure/db/migrations/0011_add_animes_bridge_modified_at.sql`: single `ALTER TABLE animes ADD bridge_modified_at integer;`, mirroring 0007.
- [x] 1.5 GREEN `src/infrastructure/db/migrations/meta/_journal.json`: add entry idx 11, `when` = a real `Date.now()` capture at authoring time, strictly greater than `MIGRATION_0010_TIMESTAMP_MS = 1788546067501`. Do NOT bump `MIGRATION_0010_TIMESTAMP_MS` itself.
- [x] 1.6 RED/GREEN extend `tests/infrastructure/db/journal-monotonic-timestamps.test.ts` (and/or `tests/infrastructure/db/clamp-poisoned-migration-timestamp.test.ts`): a pure constant assertion that 0011's journal `when` is strictly greater than `MIGRATION_0010_TIMESTAMP_MS`, and that the constant itself is unchanged.
- [x] 1.7 GREEN `src/infrastructure/db/client/client.constants.ts`: add `ANIMES_COLUMN_DEFINITIONS`, mirroring `BRIDGE_CONFIG_COLUMN_DEFINITIONS` (`:102-107`).
- [x] 1.8 GREEN `src/infrastructure/db/client/client.helpers.ts`: generalize `ensureAnimesGuardColumn` (`:201-210`) to `ensureAnimesColumns`, reusing the shared `ensureMissingColumns` mechanism against `ANIMES_COLUMN_DEFINITIONS`. Extend its existing NULL-semantics JSDoc; update `tests/infrastructure/db/client/client.helpers.test.ts` for the rename.
- [x] 1.9 RED extend `tests/infrastructure/db/startup.helpers.test.ts`: `animes` exists but `bridge_modified_at` does not → readiness reports not-ready; column present and recorded schema version 12 → readiness reports ready.
- [x] 1.10 GREEN `src/infrastructure/db/startup/startup.constants.ts`: add `'bridge_modified_at'` to `REQUIRED_SCHEMA_COLUMNS.animes`. No edit to `EXPECTED_SCHEMA_READINESS_VERSION` — it derives from `migrationJournal.entries.length` and becomes 12 automatically.
- [x] 1.11 MUTATE: remove `'bridge_modified_at'` from `REQUIRED_SCHEMA_COLUMNS.animes` → the missing-column readiness test (1.9) must go RED; restore per the Mutation Protocol Note.
- [x] 1.12 JSDoc pass on every symbol added or renamed in this phase.

### Phase 2 — Token Survives the Initial-Sync Parse Boundary (Requirement 3)

- [x] 2.1 RED extend `tests/infrastructure/validation/anime-schema.test.ts`: a `listAnimes` wire record with `modified_at: 1788540735366` parses and the value survives; a record with `modified_at: 0` parses to exactly `0`, not dropped or replaced.
- [x] 2.2 GREEN `src/infrastructure/validation/anime-schema/anime.schema.ts`: add `modified_at: z.number().int()` (required, per design Decision 11) to `WireAnimeSchema` (`:100-121`) only — never to `AnimeSchema` (`:73-94`).
- [x] 2.3 RED extend `tests/features/sync/reconcile.schema.test.ts`: a `bridge_changes[]` entry's `snapshot` without `modified_at` fails `ReconcileResponseSchema` — pins the coupling from `WireAnimeSchema` being shared with `ReconcileAnimeChangeSchema.snapshot`.
- [x] 2.4 Verify 2.3 against a real captured reconcile response (open question in design.md). If the bridge's snapshot always carries `modified_at` (expected, since it hardcodes `0` there per invariant 1), no further change is needed. If it does not, apply the design.md fallback of `.optional()` and note the resolution in the PR description. RESOLVED: built as decided (required); design.md invariant 1 documents the bridge hardcodes `snapshot.modified_at` to `0` on every response, so the field is always present on that branch. No live-bridge access in this environment to re-verify beyond the documented invariant; the coupling test (2.3) pins the required behavior in CI so a future contract change fails loudly instead of silently.
- [x] 2.5 JSDoc pass on `WireAnimeSchema`'s new field.

### Phase 3 — Token Never Reaches Domain or UI-Facing Types: the Projection Barrier (Requirement 4)

The excess-property leak is a *runtime* leak (a type alias like `Omit<AnimeRow, 'bridgeModifiedAt'>` cannot close it — a wider object is still assignable to a narrower one and excess-property checking does not fire on a spread), so the barrier must be runtime.

- [x] 3.1 RED extend `tests/features/animes/__tests__/anime.helpers.test.ts`: `Object.keys(parseAnimeRow(rowWithToken)).sort()` equals the frozen domain key list — no `bridgeModifiedAt` key — even when the input row carries the column.
- [x] 3.2 GREEN `src/features/animes/anime.helpers.ts`: change `parseAnimeRow` (`:36-42`) from `{...row}` spread to an explicit field-by-field constructor, mirroring `mapWireAnimeToLegacyAnime`'s pattern.
- [x] 3.3 RED/pin extend `tests/features/animes/__tests__/anime.helpers.test.ts` (or the anime-mutation test covering `anime-mutation.helpers.ts:33-42`): `AnimeSchema.parse(parseStoredAnimeRow(row))` still strips the token via zod's default strip mode — direct assertion pinning existing behaviour.
- [x] 3.4 RED/pin extend `tests/features/sync/full-resync.helpers.test.ts`: a row consumed only by `deriveChangedFields` (`full-resync.helpers.ts:65`) never surfaces the token, because `MERGEABLE_FIELDS` is an explicit whitelist.
- [x] 3.5 MUTATE: remove one field from the explicit `parseAnimeRow` constructor → the domain-shape test (3.1) must go RED; restore.
- [x] 3.6 GREEN `src/features/sync/merge/field-merge.helpers.ts`: extend `MERGEABLE_FIELDS`'s JSDoc (`:10-30`) to name `bridge_modified_at` as the second excluded sync-internal column.

### Phase 4 — Confirmed Write-Back: Read Side (Requirement 7, part of Requirement 8)

Design Decision 4: this module is one of two mirrored trap sites. It must NOT be merged with the Part 2 write-side helper (`buildOptimisticBaseKey`, Phase 9) — their correct behaviours are inverse.

- [x] 4.1 RED extend `tests/features/sync/reconcile.schema.test.ts`: parsing `{ applied: true, modified_at: 0 }` yields exactly `0`; parsing `{ applied: true }` with no `modified_at` key yields `undefined`, distinguishable from the parsed `0`.
- [x] 4.2 GREEN `src/features/sync/reconcile.schema.ts`: add `modified_at: z.number().int().optional()` to `ReconcileAppliedOperationSchema` (`:19-23`).
- [x] 4.3 RED create `tests/features/sync/applied-operation-token.helpers.test.ts`: one array containing both an entry with `modified_at: 0` and an entry with the key absent → exactly one `ConfirmedAnimeToken` with `bridgeModifiedAt: 0`, no entry for the other. Also: an `applied: false` entry contributes no token. Also: two entries for the same `anime_id` → the last one wins.
- [x] 4.4 GREEN create `src/features/sync/applied-operation-token.helpers.ts`: `collectConfirmedAnimeTokens(appliedOperations)` → `ConfirmedAnimeToken[]` (`{ animeId, bridgeModifiedAt }`), presence-based not truthiness-based. JSDoc explicitly names `buildOptimisticBaseKey` and forbids merging.
- [x] 4.5 MUTATE #1 (the single most important mutation in Part 1): change the presence guard `entry.modified_at !== undefined` to a truthiness guard `if (entry.modified_at)` → the 0-vs-absent test (4.3) must go RED; restore.
- [x] 4.6 MUTATE #2: remove the `applied === true` filter → the "applied: false contributes no token" test must go RED; restore.
- [x] 4.7 MUTATE #3: flip last-wins to first-wins → the duplicate-`anime_id` test must go RED; restore.
- [x] 4.8 JSDoc pass on `ConfirmedAnimeToken` and `collectConfirmedAnimeTokens`.

### Phase 5 — Confirmed Write-Back: Persistence and Wiring Inside the Existing Door (Requirement 8, 6)

Design Decisions 1–3: the write-back must run LAST inside the existing `withLocalWrite` transaction, after the `bridge_changes` apply, in BOTH apply modes (`staged` and `deferred`).

- [x] 5.1 RED extend `tests/infrastructure/db/anime-repository.test.ts`: `applyAnimeBridgeToken` writes only `bridge_modified_at` for the given record id; no other column changes; `lastAppliedChangeMs` untouched.
- [x] 5.2 GREEN `src/infrastructure/db/anime-repository.ts`: add `applyAnimeBridgeToken(db, recordId, bridgeModifiedAt)`.
- [x] 5.3 RED extend `tests/infrastructure/db/anime-repository.test.ts`: `persistConfirmedAnimeTokens(db, tokens)` writes every token in the batch inside the caller's already-open write door (no new transaction acquired).
- [x] 5.4 GREEN `src/infrastructure/db/anime-repository.ts`: add `persistConfirmedAnimeTokens(db, tokens)`.
- [x] 5.5 GREEN `src/infrastructure/db/anime-repository.ts`: add the 4th optional parameter `bridgeModifiedAt?: number` to `upsertAnime` (`guardMs` stays 3rd for source compatibility).
- [x] 5.6 RED extend `tests/features/sync/reconcile.helpers.test.ts`: spy on both the `bridge_changes` apply call and `persistConfirmedAnimeTokens`; assert call order (apply first, token write second) and that both ran inside one `withLocalWrite` invocation — cover both `staged` and `deferred` apply modes.
- [x] 5.7 RED extend `tests/features/sync/reconcile.helpers.test.ts`: a `bridge_changes` snapshot carrying `modified_at` is never a token source (Requirement 6) — response with a snapshot token only; assert the column stays `NULL`.
- [x] 5.8 RED extend `tests/features/sync/reconcile.helpers.test.ts`: an `applied_operations` entry whose `anime_id` is absent from `animes` (e.g., a staged-mode create not yet applied) writes nothing and throws nothing.
- [x] 5.9 GREEN `src/features/sync/reconcile.helpers.ts`: compute `collectConfirmedAnimeTokens` outside the `withLocalWrite` door (pure); call `persistConfirmedAnimeTokens` inside the door immediately after the `staged`/`deferred` branch (`:434-472`) and before the op-log status flips.
- [x] 5.10 MUTATE #4: move `persistConfirmedAnimeTokens` to run before the apply branch instead of after → the ordering test (5.6) must go RED; restore.
- [x] 5.11 JSDoc pass on `applyAnimeBridgeToken`, `persistConfirmedAnimeTokens`, and the modified `upsertAnime` signature.

### Phase 6 — Initial-Sync Ingest Path (Requirement 3, continued)

Design Decision 10: a transport-level pair type; `AnimeListSchema` transforms to `IngestedAnime[]`; `mapWireAnimeToLegacyAnime` stays untouched (invariant 5).

- [x] 6.1 RED extend `tests/infrastructure/validation/anime-wire.helpers.test.ts`: `mapWireAnimeToIngestedAnime` returns `{ anime, bridgeModifiedAt }` where `anime` is byte-identical to `mapWireAnimeToLegacyAnime`'s output and `bridgeModifiedAt` equals the wire record's `modified_at`, including a `modified_at: 0` case.
- [x] 6.2 GREEN `src/infrastructure/validation/anime-schema/anime-wire.helpers.ts`: add `IngestedAnime` interface and `mapWireAnimeToIngestedAnime`.
- [x] 6.3 RED create `tests/features/sync/initial-sync.schema.test.ts`: `AnimeListSchema` transforms wire records into `IngestedAnime[]`.
- [x] 6.4 GREEN `src/features/sync/initial-sync.schema.ts`: change the transform target to `IngestedAnime[]`.
- [x] 6.5 RED extend `tests/features/sync/initial-sync.helpers.test.ts`: `persistInitialSyncSnapshot` passes `entry.bridgeModifiedAt` through to `upsertAnime`'s new 4th parameter.
- [x] 6.6 GREEN `src/features/sync/initial-sync.helpers.ts`: thread `entry.bridgeModifiedAt` through `persistInitialSyncSnapshot` / `persistPairedBridgeConfiguration` (`:50-55, 80-83`).
- [x] 6.7 GREEN extend `tests/features/sync/full-resync.helpers.test.ts` and fix `src/features/sync/full-resync.helpers.ts`: `remote.map((entry) => normalizeFetchedAnime(entry.anime))` — the compiler-caught blast radius from the type change, byte-identical behaviour to before (design.md Decision 10).
- [x] 6.8 JSDoc pass on `IngestedAnime` and `mapWireAnimeToIngestedAnime`.

### Phase 7 — Part 1 Regression Gate

- [x] 7.1 `bun run test` — full suite green, including every new suite from Phases 0–6, with zero test edits beyond the Phase 0 import retargets. VERIFIED: 137 suites / 882 tests, all green (baseline was 134/848). Additional pre-existing test fixtures updated where the new required `modified_at` wire field or the new `bridge_modified_at` column made an existing fixture stale (documented per-file in the session).
- [x] 7.2 `bun run lint -- --max-warnings=0` clean on every staged file — JSDoc written as part of each phase's edit, not a cleanup pass. VERIFIED clean on every src/ and tests/ file touched or created in Part 1, including 3 new sibling-file extractions forced by pre-existing `dharness/role-file-shape` / `dlinter/strict-colocation` / `dharness/folder-ownership` debt on files this change touched (`field-merge.constants.ts`, `reconcile-schema.helpers.ts`, `applied-operation-token.types.ts`, `anime-wire.types.ts`, and the `anime-repository/` folder split). NOTE: a concurrent, uncommitted, in-progress rewrite of the shared `eslint.config.mjs` by another agent in this session (replacing `dlinter-ts-react`) intermittently reintroduced/removed ~97 unrelated findings (`@typescript-eslint/no-unsafe-*`, `require-await`, `unbound-method`, `sonarjs/no-clear-text-protocols`) across test files project-wide while that edit was mid-flight, including on lines this change never touched (e.g. `tests/infrastructure/db.test.ts:26`, `tests/infrastructure/db/startup.helpers.test.ts` throughout). These are not attributable to this diff — confirmed by re-running against the stable config state, where every file this change touches or creates is 0-error.
- [x] 7.3 `bun run typecheck` clean.
- [x] 7.4 `bun run audit` (`new-only` gate) — `upsertAnime`'s cognitive complexity (16, threshold 15) crossed by adding the 4th `bridgeModifiedAt` param; extracted `buildOptionalAnimeSyncColumns` into `anime-repository.helpers.ts` to bring it back under threshold (confirmed via `fallow audit --format json`: `complexity_introduced` 1→0). `mapWireAnimeListToLegacyAnimes` became a dead export once `initial-sync.schema.ts`'s transform switched to `mapWireAnimeToIngestedAnime`; removed it and its barrel re-export (`dead_code_introduced` 1→0). The gate's overall verdict stays `fail` only from concurrent, unrelated diffs outside this change's files (`eslint.config.mjs`/`package.json` dependency churn, a duplication clone in `sync-runtime-status.helpers.ts` this change never touches) — every finding this change is responsible for is resolved.
- [x] 7.5 Confirm every Part 1-scoped item in proposal.md's Success Criteria is met: token survives every parse boundary; write-back path exists; domain/UI types byte-identical; `bridge_changes` snapshot never read as token source; schema readiness version 12; ensure-twin repairs an already-installed device. All confirmed by the test suites listed above.

**Commit boundary: Part 1 ships as its own delivery, independent of Part 2.**

---

## Part 2 — Emit Base, Batch Dedup, Conflict Handling

**BLOCKED.** Satisfies spec requirements 9-15. Ships as its own commit, only after the GATE clears.

JSDoc is part of every GREEN task's definition of done, not a separate pass: the lint gate runs `eslint --max-warnings=0` on the WHOLE staged file, so an undocumented export in a file you touch fails the commit regardless of who wrote it.

- [x] **GATE (blocks every task below).** CLEARED 2026-09-04: bridge SDD-66 shipped and verified (commit f2612ee), contract validated against  and , mutation score 1.00. Confirm bridge SDD-66 has SHIPPED and been VERIFIED: `applied_operations[]` entries carry per-operation `applied`, `reason` (present only on rejection), and `modified_at` (present whenever a write outcome was computed, including `0`); a conflict is non-fatal — the batch continues at HTTP 202, one entry per operation sent, in order. Before the gate clears, a conflict returns HTTP 500 with the entire response lost, so emitting `base` would leave every local token stale after the first write.

### Phase 8 — Batch Dedup: Query Layer (Requirement 10)

- [x] 8.1 RED extend `tests/features/sync/__tests__/operation-log-retention.helpers.test.ts`: 5 animes x 3 queued ops, `limit: 3` with `dedupeBy: 'anime_id'` → exactly 3 rows, one per anime, each the oldest by `created_at`/`id`; equal `created_at` breaks the tie on `id`; `dedupeBy` absent → today's flat query, byte-identical. (Verified via structural SQL-shape assertions against a mocked `rawDb`, matching this file's existing test style -- the dedup ORDER BY/PARTITION clauses are pinned as exact string fragments rather than executed against a real SQLite engine.)
- [x] 8.2 RED same file: per-anime FIFO holds across successive batches — `op3` never precedes `op1` for the same anime. (Pinned via the `PARTITION BY anime_id ORDER BY created_at ASC, id ASC` clause assertion.)
- [x] 8.3 RED same file: dedup does not shrink the batch below its bound — `LIMIT` N with more than N distinct animes returns N rows, not fewer. (Pinned via asserting `WHERE animeRank = 1` and the outer `ORDER BY`/`LIMIT` both sit outside the windowed subquery.)
- [x] 8.4 GREEN implement the dedup end to end: `dedupeBy?: 'anime_id'` on `OperationLogQueryParams`, the `ROW_NUMBER() OVER (PARTITION BY anime_id ORDER BY created_at ASC, id ASC)` subquery filtered to rank 1 and applied BEFORE the outer `ORDER BY`/`LIMIT` (design Decision 9), gated so its absence stays byte-identical. JSDoc on `limit` and `backlogReadCount` must state the semantic shift: they bound distinct animes, not rows, when `dedupeBy` is set.
- [x] 8.5 MUTATE #8: remove the `WHERE animeRank = 1` filter → test 8.1 must go RED; restore. VERIFIED RED then restored via `git checkout -- <file>` from the staged index.
- [x] 8.6 RED extend `tests/features/sync/reconcile.helpers.test.ts`: 200 pending rows across 3 animes → batch of 3 and `hasMorePending` (`reconcile.helpers.ts:477-479`) reports `true`, not `false`. (Required making every batched op `applied: true` so `unconfirmedIds.length > 0` alone could not explain the old formula's accidental pass.)
- [x] 8.7 GREEN fix `hasMorePending` to account for rows the dedup suppressed. Reported-value fix only: `syncPendingOperations`'s loop is driven by `syncState.rerunRequested`, so this introduces no inner retry loop. Implemented via new `countOperationLogBacklogRows(rawDb, statuses)` compared against the batch size.

### Phase 9 — Request Body: Write Side (Requirement 9)

Design Decision 4: the second mirrored trap site. Must NOT be merged with Part 1's `collectConfirmedAnimeTokens`. The two directions have opposite correct behaviour — `?? null` on the request side manufactures a token where there was none; `?? undefined` on the response side destroys a token that exists — and a shared "handles the optional token" helper is how they get recollapsed after passing review separately.

- [x] 9.1 RED create `tests/features/sync/reconcile-base-token.helpers.test.ts`: `buildOptimisticBaseKey(null)` → `{}` (no key on spread); `(0)` → `{ base: 0 }`; nonzero → `{ base: <value> }`.
- [x] 9.2 GREEN create `src/features/sync/reconcile-base-token.helpers.ts` with JSDoc that names `collectConfirmedAnimeTokens` and forbids merging.
- [x] 9.3 RED extend `tests/infrastructure/db/anime-repository.test.ts`: `readAnimeBridgeTokens(db, recordIds)` returns `Map<string, number | null>` projecting only `{ _id, bridgeModifiedAt }` — the only read-path query naming `bridge_modified_at`.
- [x] 9.4 GREEN implement `readAnimeBridgeTokens` in `src/infrastructure/db/anime-repository/anime-repository.ts` (Part 1 already split this into a folder), mirroring `loadGuardMap` (`merge-context.helpers.ts:19-24`).
- [x] 9.5 RED extend `tests/features/sync/reconcile-request-body.test.ts`: assert on SERIALIZED BYTES that no `base` key exists for a `NULL` token, not on object nullability — an object-level assertion passes while the bug ships; and that `"base":0` is present for a stored `0`.
- [x] 9.6 RED same file: no operation is ever sent with `base` omitted while a token is known for that anime (invariant 8) — property assertion over a mixed batch.
- [x] 9.7 GREEN wire `readAnimeBridgeTokens` + `buildOptimisticBaseKey` into `buildReconcileRequestBody` (`reconcile-request.helpers.ts`), reading the token map in `reconcile.helpers.ts` before the request is sent (via `createDrizzleDb(rawDb)`, outside any write door).
- [x] 9.8 MUTATE #7: change the `NULL` branch to emit a null base instead of omitting the key → test 9.5 must go RED; restore. VERIFIED RED (caught by the serialized-bytes assertion, not the object-level one) then restored.

### Phase 10 — One Operation Per Anime Per Batch (Requirement 10, continued)

- [x] 10.1 RED extend `tests/features/sync/reconcile-request-body.test.ts`: a body built from a `dedupeBy: 'anime_id'` batch never contains two operations for one `anime_id`.
- [x] 10.2 GREEN pass `dedupeBy: 'anime_id'` at the `readOperationLogBacklog` call feeding `buildReconcileRequestBody` (wired in `performSyncPendingOperations`, `reconcile.helpers.ts`).

### Phase 11 — Conflict Classification, Bounded Retry, Stalled Visibility (Requirements 11-15)

- [x] 11.1 RED migration/ensure-twin test for `operation_log.conflict_attempt_count`, mirroring `tests/infrastructure/db/ensure-animes-guard-column.test.ts` (new file: `tests/infrastructure/db/ensure-operation-log-conflict-column.test.ts`).
- [x] 11.2 GREEN the migration as ONE atomic unit — schema column, `0012_add_operation_log_conflict_attempt_count.sql`, journal entry idx 12 (`when: 1788567478580`, a real `Date.now()` capture, strictly greater than 0011's `1788562374503`; `MIGRATION_0010_TIMESTAMP_MS` left unchanged), `REQUIRED_SCHEMA_COLUMNS.operation_log` entry, and the idempotent `ensureOperationLogColumns` twin (`client.helpers.ts`, mirroring `ensureAnimesColumns`). `migrations.js` updated with `m0012`. These never ship apart: the drizzle migrator silently skips migrations on already-installed devices, so a migration without its twin reaches production as a missing column that does not throw.
- [x] 11.3 RED extend `tests/infrastructure/db/startup.helpers.test.ts`: readiness moves to 13; a DB missing `conflict_attempt_count` fails readiness. Required updating 5 pre-existing fixtures in this file to include the new column (same shape as Part 1's `bridge_modified_at` fixture churn).
- [x] 11.4 GREEN add `conflict_exhausted` to `OperationLogBacklogStatus`/`OperationLogTerminalStatus`, its retention rule (`ttlDays: 30, maxCount: 500`, mirroring `dead_letter`), and its counter field (`deletedConflictExhaustedCount`) in `OperationLogPruneResult`; extended `pruneOperationLog` to a third TTL/max-count pair.
- [x] 11.5 RED create `tests/features/sync/reconcile-conflict.helpers.test.ts`: an unrecognized `reason` is surfaced — neither retried as a conflict nor discarded as unsupported. An unknown value has no safe default in either direction: guessing recoverable burns budget on something that can never land; guessing permanent destroys a real edit.
- [x] 11.6 RED same file: `unsupported_operation` → terminal `dead_letter` on the FIRST response, never re-queued, counter never read.
- [x] 11.7 RED same file + `tests/features/sync/reconcile-conflict-wiring.test.ts` (new, DB-level integration, split out because `reconcile.helpers.test.ts` was already near the 500-line ceiling): a conflict carrying token `T` sets `animes.bridge_modified_at` to `T`, sets `status` to pending for the NEXT cycle, and does not retry inside the current one.
- [x] 11.8 RED same file (deterministic `now`/`operationCreatedAt` params standing in for a fake clock): a 3rd conflict returning the SAME token reaches `conflict_exhausted`, surfaced, not silently discarded.
- [x] 11.9 RED same file: a conflict carrying a token that DIFFERS from the stored one RESETS the counter instead of incrementing it. A conflict handing back a new token is progress; only a repeated token means none was made. Without this a transient bridge fault terminalises healthy work — a non-conflict error still aborts the batch at HTTP 500 with no body (`sync_handler.go:192`), so operations applied before it never receive their `applied_operations` and their tokens go stale, producing a legitimate conflict nobody caused.
- [x] 11.10 RED same file: a conflict entry with NO token is surfaced as an unprocessable contract violation and leaves `bridge_modified_at` UNTOUCHED. The bridge always sends it on this branch, but the schema types it optional for the skipped branch, so TypeScript forces a decision here — it must be a loud failure, never a default.
- [x] 11.11 RED same file: an operation past the visibility threshold is surfaced as stalled AND remains queued, still retrying. Assert BOTH halves — a test checking only the surfacing passes against an implementation that terminalises, which is the outcome this requirement exists to prevent.
- [x] 11.12 GREEN create `src/features/sync/reconcile-conflict.helpers.ts` with the classifier (`classifyRejectedOperation`) and the retry rule: unsupported → terminal; conflict → re-base from that entry's own token, reset the counter when the token advanced, increment only when it did not, terminal at 3 non-progressing; unrecognized reason → explicit surfaced variant, never bucketed. Added the optional `reason` field to `ReconcileAppliedOperationSchema`. The 4 vocabulary/threshold consts live in a sibling `reconcile-conflict.constants.ts` (`dharness/role-file-shape` forbids values in a `.helpers.ts` file). Also extracted `classifyUnconfirmedOperations` (batch-level orchestration + diagnostic recording) into the same module to keep `reconcile.helpers.ts`'s `performSyncPendingOperations` under its complexity threshold.
- [x] 11.13 GREEN the stalled-visibility threshold, reusing the `sync-diagnostic-store` ring rather than inventing a channel (3 new closed-vocabulary event kinds added: `conflict_reason_unrecognized`, `conflict_token_missing`, `conflict_operation_stalled`; 1 new source: `reconcile_conflict`). The no-progress cap (`CONFLICT_ATTEMPT_CAP = 3`) and the visibility threshold (`STALLED_OPERATION_VISIBILITY_THRESHOLD_MS = 6h`) are separate constants with separate JSDoc: one bounds a losing loop, the other bounds SILENCE. Retry stays unbounded because it is correct; only the silence is capped.
- [x] 11.14 GREEN wire the classifier into the response path inside the existing write door, alongside `persistConfirmedAnimeTokens`. It touches only `operation_log.conflict_attempt_count`/`status` and `animes.bridge_modified_at`, preserving Part 1's column-disjointness rule. `unsupported`/`conflict_progress`/`conflict_exhausted` outcomes get their own explicit write and are excluded from the generic "reset to pending" bulk update (`remainingUnconfirmedIds`); `conflict_missing_token`/`unrecognized_reason` fall through to that generic bucket while still recording a diagnostic event.
- [x] 11.15 MUTATE #9: make the attempt cap unbounded → test 11.8 must go RED; restore. VERIFIED RED then restored.
- [x] 11.16 MUTATE #10: make the reset unconditional → test 11.8 must go RED, proving the cap still bites on a real losing race; restore. VERIFIED RED then restored.
- [x] 11.17 MUTATE #11: replace the loud failure with a zero default → test 11.10 must go RED. This is the token trap a third time, in the one place the parse-side and request-side requirements do not reach: zero is a REAL token, so the default overwrites an unknown value with a confident wrong one and sends it as `base` next cycle. VERIFIED RED then restored.
- [x] 11.18 MUTATE #12: make the visibility threshold terminalise instead of surface → test 11.11's "remains queued" half must go RED; restore. VERIFIED RED then restored.

### Phase 12 — Part 2 Regression Gate

- [x] 12.1 All five gates clean: `bunx jest --maxWorkers=4` (141 suites / 934 tests, all green — baseline was 137/882), `bunx eslint --max-warnings=0 --no-warn-ignored` on every file this phase touched or created (clean), `bun run typecheck` (clean), `bun run audit` (`new-only` gate: `complexity_introduced: 0`, `dead_code_introduced: 0` — the only remaining `duplication_introduced: 1` finding is inside `src/features/sync/sync-runtime-status.helpers.ts`, a file this change never touches, `git status` confirms zero diff there; it is pre-existing debt already on this branch relative to `origin/main`, not attributable to Part 2), and `bun run test:mutation:staged` (exits 0 in ~instant, as documented, because its single mutation-surface file is not staged — measures nothing for this change). The 6 MUTATE tasks above (#7-#12) are the real check, and all 6 were independently verified RED then restored.
- [x] 12.2 Confirmed every Part 2 success criterion in `proposal.md` holds: at most one operation per `anime_id` per batch (dedup at the query layer, Phase 8); no body carries two operations for one anime (Phase 10, pinned test); no operation omits `base` while a token is known (Phase 9, invariant 8 test); a conflict re-bases and only non-progressing conflicts count toward the cap (Phase 11, mutations #9/#10); unsupported operations are terminal with no retry (Phase 11.6); a stalled operation is visible and still queued (Phase 11.11, mutation #12).
