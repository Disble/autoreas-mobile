# convergent-sync

Goal: polish mobile sync to the convergent-sync rules R-1 to R-16. The approved proposal is v8, accepted by Judgment Day on 2026-10-16; ADR 009 records it.
- Branch: `feat/convergent-sync`, from `dev`.
- Delivery: work-unit commits, then a local merge to `dev`. There are no PRs, per the repository's local-merge model, so the forecast above 400 lines is `exception-ok`.
- Tests: `bun run test` (Jest) and `bun run test:kotlin`. RDD is off (global).

## Specs

Every rule below quotes the approved proposal (v8). ADR 009 holds the full text with its evidence. A spec is met only when its runtime(s) implement it and a test pins it.

### Maintainer constraints (binding, verbatim)
- C1: "me parece mejor que reaccione por eventos a que reaccione por loops". The design is event-driven and never polls. An interval may filter events; it is never a timer.
- C2: JS has no background responsibility. Kotlin runs always, including while the app is open. There are two dispatchers, one per process.
- C3: There is one exit per runtime. The maintainer's model is an HTTP interceptor: "hay un solo lugar de donde sale".
- C4: Events are never coalesced. Each event reaches the bridge, in order. The maintainer's reason: "Bridge funciona esperando cada uno de los eventos para generar el historial".
- C5: Polish, don't rebuild. The three queue tables stay (`operation_log`, `season_rating_queue`, and the diagnostics outbox in `telemetry.db`).
- C6: The R-16(b) UI is a separate track and is out of scope here. The maintainer said: "nos estamos distrayendo con temas de UI".

### Rules
- **S1 (R-6) Forward-only cursor.** Both runtimes persist `MAX(stored, next)`. The cursor never moves back.
- **S2 (R-13) Guarded transitions.**
  - Every `operation_log` status change is compare-and-set. A runtime never reverts a row that the other runtime already confirmed.
  - Claims are per queue key: the anime for `operation_log`, the season for `season_rating_queue`. Each claim has an owner and a time, stored in added columns.
  - The other runtime skips a key with a live claim. It does not wait or retry.
  - A claim expires after 60 s. The holder re-checks its claim before each send.
  - Recovery resets only expired claims.
- **S3 (R-15) Conflict rule in both runtimes.**
  - Every conflict re-bases.
  - After 3 consecutive conflicts without the token advancing, the row becomes `conflict_exhausted`.
  - Kotlin persists the conflict token and the attempt count.
- **S4 (R-14) Chaining.**
  - The claim holder sends the oldest row, waits for its confirmation and new token, and then sends the next row.
  - The chain stops on any of these:
    - a rejection. The rest of that key waits for the next cycle. A given-up row never holds the rows behind it (L14).
    - a network error or timeout. The row stays pending and is not counted as a conflict.
    - 20 s of chaining in one cycle.
  - The claim is released when the chain stops.
- **S5 (R-3, R-11) Never send without base.**
  - Every path that writes an anime stores `bridge_modified_at`, including the snapshot heal and upsert.
  - Unpairing clears the tokens and the old pairing's queues.
  - When a token is missing, the claim holder fetches first and stores only the token. The fetch has four outcomes:

    | Outcome | Result |
    |---|---|
    | Bridge unreachable | Stays pending |
    | 404 | Unresolved |
    | Token returned | Send |
    | No token | Unresolved, logged |
- **S6 (R-16a)** A remote change skipped by `defer_outbox` is never lost behind an advancing cursor.
- **S7 (R-16b) Unresolved contract.**
  - Covered failures: `dead_letter`, `conflict_exhausted`, rating 404/409, and the R-3 404 and no-token outcomes. Each becomes a durable unresolved state.
  - The heal and the merge treat an unresolved key as pending.
  - Status counts unresolved keys.
  - There is one resolution entry point, and it acts on the whole key:
    - keep local: re-chain from a fresh base;
    - keep bridge: drop the rows and apply the remote state.
  - For 404 and no-token, only keep-bridge is offered. For 404, the delete rule applies.
  - No UI.
- **S8 (R-5) Per-message failure.**
  - One failing message never blocks others.
  - Each failure class has one fate, the same in both runtimes.
  - I4: a rating failure no longer fails the cycle.
  - I3: 401 gets a defined terminal fate.
- **S9 (R-2) One registry, one exit per runtime.**
  - Kinds are registered once.
  - Callers enqueue and call `requestFlush(reason)`. Only the dispatcher sends, through `BridgeClient` (JS) or `SyncEngineHttp` (Kotlin).
  - I1: ratings get a kick and a native sender.
  - I2: the episode kick goes through the coordinated cycle.
  - I8: `season_changed` and `preferences_changed` go through the entry point.
- **S10 (R-7) Reconnect catch-up.**
  - Heal on mount, on resume and on WS reconnect.
  - The reconnect catch-up:
    - is single-flight;
    - always pulls since the cursor and drains staged changes;
    - runs the full snapshot only if the last successful heal is more than 5 min old (a failed heal does not reset the interval);
    - does not repeat the mount heal on the first open.
- **S11 (R-9) Status tells the truth.**
  - No "Esperando a la PC" while the bridge is reachable.
  - I6: the season refresh after a rating also writes `active_season_cache`.
- **S12 (R-8) Retry stays alive.** Tearing down the ticker must not cancel the only retry path (R4).
- **S13 (R-4, R-10) Contract fixtures.**
  - Shared fixtures pin bridge idempotency, ratings and the failure classes.
  - Behavior that JS and Kotlin share is pinned by the same fixture.
- **S14 (R-12) No dead paths.** Every path is reachable, and every write is read. Dead code found while doing S1-S13 is removed completely; leave no compatibility leftovers.
- **S15 (prep)** ADR 009 records the convergent-sync rules and amends ADR 008 decision 3. `docs/sync-architecture-audit.md` is corrected:
  - I7;
  - the drainer count is six, not five;
  - presence comes before the lock in the sequence;
  - the Kotlin `bridge_modified_at` writer.

Out of scope:
- the R-16(b) UI;
- the "PC" to "Bridge" copy migration, which is a separate change;
- any bridge-side change.

## Tasks

High-risk tasks get an independent verifier after their own checks.

| ID | Specs | Route | Risk | Status | Commit |
|----|-------|-------|------|--------|--------|
| T1 | S15 | inline | none (docs) | done | 36ee0d9 |
| T2 | S1 | inline | 6 | done | fb2acab |
| T3 | S2 (schema), S3 (schema), S7 (schema) | inline + verifier | 1 (migration) | done | 751d3f1 |
| T4 | S2 | inline + verifier | 4 (concurrency) | done | 3a040d3 |
| T5 | S3 | inline | 3 | done | 7ad484c |
| T6 | S4 | inline + verifier | 4 | done | b48ddca, 8acbc94, 6300955 + hold removal (see L14) |
| T7 | S5 | inline + verifier | 1 (clears data on unpair) | done | abd64c8, 04e2fe1, f5b4ae6, c80821a (see L16) |
| T8 | S6 | inline | 4 | pending | |
| T9 | S7 | inline + verifier | 1 | pending | |
| T10 | S8 | inline | 3 | pending | |
| T11 | S9 | inline | 3 | pending | |
| T12 | S10 | inline | none | pending | |
| T13 | S11 | inline | none | pending | |
| T14 | S12 | inline | 5 | pending | |
| T15 | S13 | inline | none | pending | |
| T16 | S14 | inline | 6 | pending | |

All tasks route inline. No writer is delegated, because none of the Writer-trigger reasons applies: the tasks are sequential and share the sync core files.

## Log

- **L1 (2026-10-16, user):** "Ya, si es que todo está aprobado y bien atado, iniciamos desarrollo oficialmente. Haz los preparativos, la previa que tengas que hacer, y después de eso inicia el ODD."
- **L2:** Branched from `dev` (`78daa13`), not from `fix/anime-card-layout`. That branch has 5 unmerged commits that are waiting on the T3 device check for anime folders, and this feature does not depend on them.
- **L3:** Proposal v8 was approved after two Judgment Day rounds. The ledgers are in the session scratchpad (`jd-target-v6`, `jd-target-v7`, `jd-target-v8`), and ADR 009 carries the final text.
- **L4 (T1):**
  - ADR 009 written, and ADR 008 status amended.
  - The audit was corrected. I7 was withdrawn: `SyncEngineRuntimeStatus.kt:14-28`. The sixth drainer (`drainPendingRemoteChanges`) was drawn. The presence probe now comes before the lease (`SyncEngineRunner.kt:61-63`). The Kotlin token writer was added. The I6 citation was fixed.
  - Commit `36ee0d9`; the gate was green.
- **L5 (T2):** RED was observed in both runtimes, using a cursor that the other runtime advanced while the request was in flight.
  - JS: the behaviour test expected 60 and received 41.
  - Kotlin: `cursorNeverMovesBelowAValueTheOtherRuntimeStoredDuringTheRequest` expected 20 and got 14.
  - GREEN: both writes now use `MAX(COALESCE(last_changelog_id,0), next)` against the stored value.
  - Mutation evidence: removing `MAX` is exactly the observed RED state.
- **L6 (T3):** migration 0018 adds `operation_log.claim_owner`, `claimed_at` and `unresolved_reason`, plus `season_rating_queue.claim_owner` and `claimed_at`.
  - Each column has a repair twin, and both tables are listed in `REQUIRED_SCHEMA_COLUMNS`.
  - The readiness version is now 19 in both TS and Kotlin, so Kotlin waits for the JS repair.
  - The `season_rating_queue` CREATE keeps its 0009 shape, so a fresh install never collides with 0018.
  - RED: the parity and readiness contracts failed (4 tests). Mutation: removing the 0018 SQL fails all 3 tests in `outbox-claim-columns.test.ts`.
  - The new `buildOperationLogEntity` fixture centralizes row defaults.
  - Commit `751d3f1`; the gate was green.
  - Independent verifier: PASS on all 6 scenarios, no blockers (fresh install, upgrade at 18, partial columns, readiness ordering, season-queue CREATE, column types). Probe sanity: deleting a repair twin fails 3 probes. Advisory carried to T4: the Kotlin test fixtures lacked the new columns.
- **L7 (T4 map):** no status write was compare-and-set in either runtime; both backlogs selected `IN ('pending','processing')`; Kotlin recovery reset every `processing` row; the read and the claim were separate steps in both runtimes; Kotlin's `updateOperationStatus` treated 0 rows as lease loss.
- **L8 (T4):** per-key claims with compare-and-set in both runtimes.
  - JS: `outbox-claim.helpers.ts` owns its write door (`claimOperationLogBatch`): the read and the claim share one `BEGIN IMMEDIATE`. Keys with a live claim (any owner) are excluded at the anime level, before the dedup ranks rows. The holder re-checks its claim after the diagnostics flush, right before the send. Every status write (confirm, dead-letter, pending, conflict outcome, failure revert) is compare-and-set on `status='processing' AND claim_owner AND claimed_at`, and releases the claim.
  - Season queue: the key is `season_id`. The claim is a compare-and-set that matches nothing while any row of the season holds a live claim. The resolve update and the delete are compare-and-set on the claim.
  - Kotlin: `OutboxClaim.kt` holds the backlog query (same key exclusion) and the claim. `updateOperationStatus` is compare-and-set on the claim and checks the lease explicitly with `requireLeaseOwnership`, so zero rows now means a lost key, not a lost lease. Recovery resets only `processing` rows whose claim expired or predates claims.
  - RED: JS operation_log 5 of 6 and season queue 4 of 5 (the passing ones are regression guards); Kotlin 6 of 6 (one failed on a fixture bug: a 2023 `created_at` let the pruner delete the synced row; fixed to `now`).
  - GREEN: JS behaviour + sync + infrastructure 1125/1125; Kotlin 325/325. Mock-heavy reconcile unit tests use the pass-through `tests/support/outbox-claim-mock.helpers.ts`; the claim SQL is pinned against real SQLite only.
  - `SyncEngineCycle.kt` shrank from 513 lines (claim SQL moved out to `OutboxClaim.kt`).
  - Kotlin's pre-send re-check is the claim's read-back inside the same transaction, right before the single send. A second read after commit added only unreachable branches and broke the Kover CORE branch floor (83.9% < 87%). Per-send re-checks inside a chain land with T6. Unclaimed state is `UNCLAIMED` (matches no row) instead of a nullable claim.
  - Commit `3a040d3`; the gate was green after fixing lint (unused import, single-pass loop), typecheck (mock type), fallow (support file reached only through `jest.requireActual`, switched to `require`) and Kover.
- **L9 (T5):** the conflict rule in Kotlin, mirroring JS `classifyRejectedOperation`.
  - `ReconcileConflict.kt` classifies a rejected entry: `unsupported_operation` dead-letters; a conflict with a token re-bases (the anime gets the bridge token), resets the count to 0 when the token differs from the `base` this attempt sent, otherwise increments it, and the third non-advancing conflict becomes `conflict_exhausted`; a conflict without a token or an unknown reason goes back to `pending` (never guessed).
  - The applier now receives the sent tokens (`storedTokens`) and a claim-guarded `writeConflictOutcome` (status + `conflict_attempt_count`, compare-and-set like every other status write since T4).
  - JS already implemented the rule (`reconcile-conflict.helpers.ts`, pinned by `reconcile-conflict*.test.ts`); its conflict write became compare-and-set in T4.
  - RED: `SyncEngineConflictRuleTest` 4 of 6 (the 2 passing are regression guards: token missing, unsupported). GREEN: Kotlin gate green, including Kover CORE 100% branch on the applier (an `?.let ?:` with an unreachable null branch was rewritten as an `if`).
  - Commit `7ad484c`; gate green. Two earlier commit attempts were killed by the host for low memory, not by the gate.
- **L10 (T4 verifier):** PASS on all five S2 clauses, no blockers. 8 JS probes pass at `3a040d3` and fail at `751d3f1`. Kotlin was judged by reading (its scratch build failed for environment reasons). Advisories:
  - token writes (`bridge_modified_at`) from a response are not claim-guarded (pre-existing); decide in T6;
  - nothing pins the JS and Kotlin backlog SQL to the same text (T15);
  - Kotlin has no "newer row of a claimed anime" test; the verifier's probes (P1-P6b, P8) are still to be committed as regression tests.
- **L11 (T6, JS):** the JS cycle chains per key.
  - `reconcile-round.helpers.ts` (new) owns one round: re-check the claim, send, apply. In the same transaction that confirms a row, `claimChainSuccessors` claims the key's next `pending` row under the same claim, so the other runtime cannot slip in between. The loop in `performSyncPendingOperations` sends rounds until none is claimed.
  - Stops: a rejected row claims no successor (its key stops); a failed round releases its rows to `pending` and rethrows (earlier rounds stay committed; not counted as a conflict); past `OUTBOX_CHAIN_BUDGET_MS` (20 s from the claim) no successor is claimed. Telemetry rides the first round only; each round sends the previous round's cursor.
  - Rows behind a given-up row are held: the claimed backlog skips every anime with a `dead_letter` or `conflict_exhausted` row. Existing dead-lettered animes are held too until R-16(b) resolves them or retention prunes the row.
  - T4 verifier advisory 1 closed for JS: response tokens are written only for keys still held, re-read inside the write door.
  - RED: 4 of 6 in `outbox-chain.behaviour.test.ts`; GREEN 6/6; mutation: removing the 20 s check or the given-up exclusion each fails its test. Unit tests: 3 mocks now return the write door's result, and the token write-back tests send the operation they confirm. JS suites 1131/1131.
- **L12 (T6, Kotlin + T4 probes):** the `:sync` cycle chains the same way.
  - `runCycle` loops rounds; the response transaction claims the next row of every key it confirmed (`claimChainSuccessors` in `OutboxClaim.kt`), unless the injectable `clock` is past claim time + `OUTBOX_CHAIN_BUDGET_MS`. Each round sends the previous round's cursor; a failed round reverts only its own rows; the transport, HTTP and parse exits report the rounds already synced (lease loss and the catch-all still report 0, unchanged).
  - The backlog query skips keys with a given-up row, like JS. The applier writes tokens only for keys still held and returns only confirmations of held rows, so a key taken over mid-request is neither counted nor chained (found by the takeover test: a second round had sent the next row).
  - `HeldRowWriter.kt` (new) holds the claim-guarded status writes and the held re-read; `readAnimeBridgeTokens` moved to `OutboxClaim.kt`. `SyncEngineCycle.kt` back to 455 lines (was 504 since T5, over the 500 limit).
  - Kover CORE now also gates `HeldRowWriter`, `OutboxClaimKt`, `OutboxClaim`, `ReconcileConflictKt` and `RejectedOperationOutcome` (they had left the gated cycle in T4/T5 ungated). Kotlin gate green.
  - Tests: `SyncEngineChainTest` (6, mirroring the JS file) and 2 applier token-guard cases, written after the code; mutation instead of RED: removing the 20 s check, the given-up exclusion, or the held filter fails exactly its test.
  - T4 verifier probes committed as regression tests: P1-P4 in `outbox-claims.behaviour.test.ts`; Kotlin "newer row of a held key" in `SyncEngineOutboxClaimTest`. P6/P6b/P8 were already covered by existing cases; P5 (seasons) by `season-rating-claims`.
- **L13 (T6 verifier):** PASS on every S4 clause in both runtimes, no blockers. One correction batch for the advisories worth fixing now:
  - A1 (caused by T6): `hasMorePending` counted rows of keys held behind a given-up row, so the foreground cycle never recorded success while such a row was retained (up to 30 days). Now `countSendableBacklogRows` excludes them.
  - D1: JS counts only confirmations of rows it still held, like Kotlin.
  - D2: Kotlin piggybacks `client_telemetry` on the first round only, like JS (`ReconcileRequestBody.build(includeTelemetry)`).
  - A3 (Kotlin outcome on lease loss / catch-all reporting 0): tried, but an existing test pins `0, 0` there and nobody asked to change it; reverted, and L12's wording corrected.
  - Still open: A2 (a whole-batch 4xx, including 401, dead-letters and then holds every key in the round) for T9/T10; A4 (JS per-round cursor without `max`; the stored cursor is forward-only); A5 (Kotlin's per-send re-check is the in-transaction successor claim, as in T4).
  - Verifier probes V1-V6, V7b, V8 committed as `tests/behaviour/sync/outbox-chain-edges.behaviour.test.ts` (V7b and V8 failed at `8acbc94`); V7 is P4 in `outbox-claims`. JS 1143/1143, Kotlin gate green (`SyncFloorSchedulerTest` "Invalid window pointer" failed once under memory pressure and passed on rerun; unrelated to this change).
- **L14 (2026-10-16, requirement change, S4):** the maintainer removed the hold behind a given-up row. Verbatim:
  - "Sí, a mí me parece mejor quitar la retención. Es que te lo digo, todo depende del contexto. No sé bajo qué contexto se pensó la política que estabas aplicando, pero es que realmente nosotros no hacemos un más uno más uno más uno, sino que mandamos directamente el número 7, 8, 9. y perder un número sí puede ser problemático a nivel de histórico, pero tampoco tanto porque se supone que nosotros tenemos una arquitectura que permite, entre comillas, reintentar por dos fuentes diferentes dentro del mismo mobile."
  - Earlier in the same exchange: "Tiene que ser general, porque si no creamos casuísticas que después van a ser difíciles de seguir." and "Yo prefiero una política de retención." (superseded by the removal above).
  - Rationale, verified in `anime-mutation.helpers.ts`: every event is an `update` with absolute values (`episodesWatched`, `lastWatchedAt`, optional `status`/`premieredAt`/`firstCycle`). A given-up event is never applied with or without a hold, so the hold only froze the later, valid events, and nothing could release it (the R-16(b) UI is out of scope, C6) except retention pruning after 30 days. Residual risk, unchanged by a hold: an optional field carried only by the given-up event does not reach the bridge; R-16(b) records it as unresolved.
  - Change: both backlog queries drop the given-up exclusion (live-claim exclusion stays); `countSendableBacklogRows` is deleted (its only purpose was the hold); S4 and ADR 009 R-14 rewritten. Within a cycle a rejection still stops its key.
- **L15 (T7, S5):** three commits, gate green on each.
  - `abd64c8`: the snapshot heal stores each anime's token with the fields it writes (new row via `upsertAnime`'s token slot, existing row via `applyAnimeBridgeToken` when it differs; never for a key with an unconfirmed outbox op). Unpair (`clearBridgeConfig`) deletes `bridge_config`, `operation_log`, `season_rating_queue`, `pending_remote_changes` and nulls every `animes.bridge_modified_at` in one write-door transaction.
  - `04e2fe1` (JS) and `f5b4ae6` (Kotlin): fetch-first via `GET /api/animes/{id}` (already served by the bridge, returns the live `modified_at`, 404 when missing). Token: stored alone, only while NULL, then sent as base. 404 / no token: the whole key becomes `dead_letter` with `unresolved_reason` `bridge_404` / `token_missing` (held rows CAS on the claim, plus unclaimed pending rows of the key); no-token is logged. Transport failure or any status other than 2xx/404: held rows back to `pending`, released.
  - Assumptions: the diagnostics outbox (separate file `autoreas-telemetry.db`) and the Kotlin journal are device telemetry, not pairing queues, so unpair leaves them. The merge and the staged drain still store no token: `bridge_changes[].snapshot.modified_at` is hardcoded 0 by the bridge, and a stale token is corrected by the R-15 conflict re-base.
  - Tests that pinned a send without base (JS behaviour seeds, Kotlin `SyncEngineCyclePullOnlyAndFenceTest` x2, `SyncEngineConflictRuleTest` null-token case) now seed a token or assert the R-3 rule. `reconcile.helpers.test.ts` split (pure cases to `reconcile-confirmation-schema.test.ts`) to stay under 500 lines.
- **L16 (T7 verification):** independent verifier FAILED S5 bullets 2 and 3 with two T7-caused blockers, both runtimes. B1: a token fetched during an unpair was written back for the old pairing. B2: the held re-check ran before the fetches, so a key taken over during a fetch was still posted (S2 regression). One correction batch `c80821a` by two parallel delegated writers (JS and Kotlin, disjoint surfaces; route change after the maintainer flagged the long-session backstop): the token write is guarded by `EXISTS` a held `processing` row under this claim, and the rows to send are re-read as held inside the fetch-first transaction. Probes committed as `fetch-first-races.behaviour.test.ts` and `SyncEngineFetchFirstRacesTest.kt`. Scoped recheck: B1 FIXED, B2 FIXED, no fix-caused defects. Bullet 1 PASS.
  - Advisories, not fixed: A1 N tokenless keys with a timing-out bridge cost N x 10 s in one round (sequential fetches); A2 a throw inside `resolveMissingTokens` leaves rows `processing` until the claim expires; A3 `giveKeyUp` also dead-letters unclaimed pending rows released by a simultaneous takeover (tiny window, intended whole-key give-up); A4 unpair keeps `active_season_cache` and `sync_runtime_status` (not queues), and an in-flight Kotlin cycle can still stage `pending_remote_changes` after the delete (pre-existing, staging is unfenced); A5 `buildOptimisticBaseKey`'s no-base branch is now unreachable, candidate for T16 (S14).
  - Route from T8 on: per the maintainer (2026-10-16, "¿Por qué no, por qué estás editando inline? ¿Por qué no estás siguiendo el workflow del ODD?"), the long-session backstop has fired, so each task goes to a delegated writer; disjoint JS and Kotlin units run in parallel; high-risk tasks keep an independent verifier.
- **Next:** T8.
