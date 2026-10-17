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
- C5: Polish, don't rebuild. The diagnostics outbox in `telemetry.db` stays its own queue. Season ratings move into the anime queue (`operation_log`), amended by L20; `season_rating_queue` is retired.
- C6: The R-16(b) UI is a separate track and is out of scope here. The maintainer said: "nos estamos distrayendo con temas de UI".

### Rules
- **S1 (R-6) Forward-only cursor.** Both runtimes persist `MAX(stored, next)`. The cursor never moves back.
- **S2 (R-13) Guarded transitions.**
  - Every `operation_log` status change is compare-and-set. A runtime never reverts a row that the other runtime already confirmed.
  - Claims are per queue key: the anime for every `operation_log` row, anime edits and season ratings alike (L20, L28). Each claim has an owner and a time, stored in added columns.
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
  - An unresolved key never blocks: the merge and the heal treat it like any other key (L18). It is resolved automatically when a later local edit of that key is confirmed by the bridge, and every automatic resolution is logged with its reason.
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
| T8 | S6 | delegated writer + verifier | 4 | done | 46ac414 + probes (see L17) |
| T9 | S7 | delegated writer + verifier | 1 | done | 27d4579, 481c121, 1ebf20a (see L21) |
| T10 | S8 | delegated writer + verifier | 3, 1 | done | 429f1b0, e44e371 (see L22) |
| T11 | S9 | delegated writer + verifier | 4, 3 | done | b0ab853, 9f349a7 (see L23) |
| T12 | S10 | delegated writer + verifier | 3 | done | c200de2, b960c04 (see L24) |
| T13 | S11 | delegated writer + verifier | 3 | done | 5598b40, ebecfd4 (see L25) |
| T14 | S12 | delegated explorer | none | done | no code change (see L26) |
| T15 | S13 | delegated writer + verifier | 3 | done | 88673bd (see L27) |
| T16 | S14 | delegated writer + verifier | 2, 3, 6 | done | 2736b65 (see L31) |
| T17 | S7, S9 (L20) | delegated writer + verifier | 1 (migration moves stored ratings) | done | 9b91d75, c40c739, 846b2fa, d8a26a3, e3b47d0, dff41c0 (see L30) |
| T18 | S14 (L32) | delegated writer + verifier | 1, 3 (columns and wire fields) | done | f22527d, ca73da0 (see L33) |

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
- **L17 (T8, S6):** route: one delegated writer (long-session backstop), then an independent verifier (risk item 4). `46ac414`: a change skipped by `defer_outbox` stays in `pending_remote_changes`; `applyStagedAndIncomingRemoteChanges` (`remote-change-drain.helpers.ts`) runs both apply paths (foreground reconcile in deferred mode, and the drain), applying staged rows plus incoming changes oldest-first under the merge rules; still-deferred rows stay staged, others are deleted in the same transaction. Writer's added rule: a kept change is dropped when a same-or-later delete of that anime is applied in the same pass. The foreground reconcile now also applies rows the Kotlin cycle staged (the table cannot tell them apart).
  - Verifier: S6 PASS, no blockers, no regression to S1-S5. The echo assumption is confirmed in the bridge: reconcile applies the pending operations and records their changelog rows synchronously before listing `bridge_changes`, unfiltered by device, and the echo's timestamp sorts after earlier PC changes. Probes V1-V6 committed as `deferred-remote-change-edges.behaviour.test.ts` (V1-V5 fail at baseline).
  - Advisories: A1 a change deferred behind a given-up edit (`dead_letter`, `conflict_exhausted`) is applied on the next pass, so the PC value silently overwrites the given-up local value; S7 ("merge treats an unresolved key as pending") must add that hold in T9. A2 `drainedCount` re-counts kept rows and has no consumer: candidate for T16 (S14). A3 `pending_remote_changes` is pruned only by unpair; a long-pending key keeps its rows and every round reloads the table. A4 kept changes wait for the next reconcile or drain (no scheduled pass, per C1).
- **L18 (2026-10-16, requirement change, S7):** the maintainer chose that an unresolved key does not block. Verbatim: "Sí, prefiero que no bloquee, pero una, un detalle que me gustaría que tengas presente. Si vas a marcar como resuelto automáticamente, me vas a hacer logs respectivos del porqué. Aunque sea un proceso determinístico, este proceso determinístico va a explicar que se mandó automáticamente por tal razón. Tenemos logs. No tenemos razón para ocultarlo eso."
  - Rationale: holding inbound changes and skipping the heal for an unresolved key would freeze that anime with no way out while the R-16(b) UI is out of scope (C6), the same freeze L14 rejected for the outbound direction. Events are absolute, so a later confirmed local edit supersedes the given-up one.
  - Change: S7's merge/heal line rewritten; ADR 009 R-16(b) amended. T8 advisory A1 (a PC change overwrites a given-up local value) is the intended behaviour now, recorded as unresolved, not a defect.
- **Next:** T9 (S7).
- **L19 (2026-10-16, T9 retention):** The maintainer, after learning that retention only covers anime edits (diagnostics have their own store, reconcile checks store nothing), answered: "Sí, visto así, pues la política no favorece mucho en el contexto actual." Decision: unresolved anime edits and unresolved ratings are exempt from retention; they stay until resolved (automatically or by the entry point). Synced rows keep their 7-day cleanup. Pending implementation inside T9.
- **L20 (2026-10-16, season ratings join the anime queue):** The maintainer, verbatim: "Para mí, todo lo que respecta a seasons es parte del mismo contexto semántico de anime. Un contexto diferente sería, por ejemplo, logs. Eso sí es diferente y necesita posiblemente un tratamiento aparte. y esta decisión es independiente de si tiene su propio endpoint." Decision: season ratings become an event kind in `operation_log` with the anime as key, keeping their own bridge endpoint; a migration moves queued ratings and retires `season_rating_queue`. Diagnostics stay a separate queue. C5 amended; new task T17, after T11 (the single exit).
- **L21 (2026-10-16, T9 closed):** `27d4579` unresolved contract (anime keys = dead_letter/conflict_exhausted rows; rating keys = failed not_found/conflict; resolved = given-up rows deleted; auto-resolution by a later confirmed edit of the key, logged with key, rows and reason in JS after commit and Kotlin inside the transaction; `readUnresolvedKeyCount`, `listUnresolvedKeys`, `resolveUnresolvedKey` keep_local/keep_bridge with typed refusals). Verifier: B1 (an unresolved rating counted as pending forever) fixed in `481c121` with its probe as regression test. `1ebf20a` implements L19 (no retention for given-up rows; synced cleanup unchanged); verifier PASS, synced pruning byte-identical to baseline. Advisories: Kotlin log written before commit; no-token keep_bridge refuses with remote_state_unavailable; unresolved files not in jest.coverage-tiers.js; JS `pruneOperationLog` has no production caller (for T16, S14); unresolved rows can grow unbounded (accepted by L19). Next: T10 (S8).
- **L22 (2026-10-16, T10 closed):** `429f1b0`: one fate per failure class in both runtimes, table in ADR 009 R-5. A non-401 4xx on a multi-message round re-sends each message alone (no telemetry, each on the cursor the previous reached); only the offender is given up. 401 is terminal unresolved for the whole round. A failing rating no longer fails the cycle; rating 401/403/422 become unresolved (`auth_repair`, new kind `rejected`); stored `failed/auth_repair` ratings now read as unresolved. Kotlin `runPullOnlyAttempt` folded into the round loop. Verifier: S8 PASS in both runtimes, JS differential byte-identical to baseline except the intended isolation. A1 (Kotlin left the in-flight row `processing` after a local write failure during isolation; JS released it) fixed in `e44e371` with probes P1-P6/K1-K5 as regression tests. Advisories: isolation ignores the 20 s chain budget (up to 200 single sends; a long isolation can outlive the 60 s claim, so a takeover could duplicate an absolute-value event, harmless to the bridge); a cycle with an isolated rejection reports pending; when reconcile itself fails the rating drain does not run that cycle (T17). Next: T11 (S9).
- **L23 (2026-10-16, T11 closed):** `b0ab853`: `requestFlush(rawDb, reason)` single-flight dispatcher (one running cycle, at most one follow-up; registered at runtime by the sync runtime to avoid a circular import). Anime mutations, rating enqueue, runtime triggers, WS `season_changed` and `preferences_changed(true)` all go through it; the coordinated cycle sends anime ops (+diagnostics), ratings, then refreshes the active season. Kotlin diagnostics now use `SyncEngineHttp`. `useReconcile` and `@tanstack/react-query` removed. Scope split by the parent: the native rating sender (Kotlin half of I1) moves to T17, where ratings join `operation_log` (L20). I6 fixed as a side effect (T13 to confirm). Verifier: all S9 clauses PASS, concurrency and Kotlin parity hold; B1 (a failed WS season refresh failed the whole cycle and could mark a delivered chapter action failed) and A2 (lost generation guard let a late answer restore a cleared season) fixed in `9f349a7`, with V1-V7 as regression tests; a follow-up with no dispatcher now settles to idle. Advisories: the architecture guard is regex-based; one extra reconcile per burst of WS/manual requests; a follow-up keeps its first reason; `use-incremental-sync-handler.ts` and the in-flight guard in `syncPendingOperations` are dead (T16). Next: T12 (S10).
- **L24 (2026-10-16, T12 closed):** `c200de2`: `useWebSocket` gained `onReconnected` → `requestFlush(rawDb, 'ws_reconnected')` (persisted as `ws_sync_required`). The snapshot heal moved from `useForegroundResync` into the dispatched cycle as a demand per flush reason (bootstrap/app_active always; ws_reconnected only if the last successful heal is over 5 min old; in-memory per DB, written only on success; strongest demand wins). Risk assessed as item 3 after the fact, so an independent verifier ran. Verifier: B1 (a mount/resume cycle whose sends failed skipped the heal, a regression vs baseline) and B2 (bridge down at mount: the first open after failed attempts was not a reconnect, so no catch-up) fixed in `b960c04`, with P1-P5, D-healthy and W1-W4 as regression tests. A row given up on a 4xx is healed from the bridge (L18). Advisories: one extra cover sweep per reconnect; an old socket's `onclose` can null a newer `wsRef` (pre-existing). Next: T13 (S11).
- **L25 (2026-10-16, T13 closed):** `5598b40`: the visible status takes reachability from the latest exchange in either runtime (`bridgeContact` in the connection store; a Kotlin `sync_runtime_status` success counts only if it is the latest attempt and newer than the JS evidence; unpair clears it); new facade value `reachable`; pending changes with a reachable bridge show "Bridge conectado" / "Por enviar" / "Tienes N cambios guardados en este dispositivo. Se enviarán en el próximo sync." (copy proposed by the writer, confirmed by the maintainer in L29). I6 pinned by tests (it landed in T11). Verifier: S11 PASS, 270-input differential identical to baseline except the 12 reachable-with-pending cases. A1 (after the PC turns off with the app in the foreground, "Bridge conectado" stayed until the next event) fixed in `ebecfd4`: a drop of an opened WS requests one `ws_disconnected` flush (no heal), and a failed cycle downgrades the status. Advisories: a silent socket death with no close event keeps the claim until the next event (no heartbeat by design); the 72 h stale warning is suppressed while the bridge answers; remaining "PC" copy in the status path is for the rename track. Next: T14 (S12).
- **L26 (2026-10-16, T14 closed without code):** R4 confirmed only in part. `ForegroundSyncTickerModule` `OnDestroy { stopTicking() }` persists `isTicking=false` and cancels the alarm, but Expo `OnDestroy` runs only when the React instance is invalidated (JS reload, a dev-mode exception), not on activity destroy, process death or a release JS crash. It is not the only retry path: the WorkManager floor `SyncFloorWorker` (15 min) skips only while the tick alarm is armed, so cancelling it hands the background back to the floor (pinned by `TickAlarmSchedulerTest`, `SyncFloorAttemptTest`), and the next JS mount calls `ticker.start()` again. S12/R-8 already hold. Audit R4 annotated. Open, not S12: after a dev reload the 15 s cadence waits for the next mount (floor covers it); if the floor registration never succeeded the ticker is the only path; reload ordering of old `OnDestroy` vs new `start()` is provable only on a device. Next: T15 (S13).
- **L27 (2026-10-16, T15 closed):** `88673bd`: 35 JSON scenarios in `tests/contract-fixtures/` (27 anime-outbox, 8 season-rating JS-only until T17) run by one Jest and one Robolectric runner on the same files (idempotent resend, own echo staged, every R-5 class, fetch-first outcomes, rating fates). They exposed D1: Kotlin turned a wrong-type `applied_operations`/`bridge_changes` into `[]` and advanced the cursor past unstaged remote changes; `ReconcileResponseParser.kt` now rejects what the JS schema rejects. Verifier: PASS; 88/91 parity cases match, the 3 gaps (huge `modified_at`, trailing text) are never produced by the bridge (Go `ReconcileResponse` always sends `status`, never null for optional fields). Open, decision deferred: 5 snapshot-level divergences in `reconcile-response-divergence-cases.json` (JS rejects the whole response, Kotlin accepts); making them malformed in both means one bad snapshot fails every cycle until the bridge stops sending it. Duplicated older tests listed for T16. Next: T16 (S14).
- **L28 (2026-10-16, T17 design accepted, order changed):** T17 runs before T16 so the retired rating code is cleaned once. Design (phase 1, read-only): a rating is an `operation_log` row `operation='season_rating'`, `anime_id` key, payload `{seasonId, grade, ratedAt}`, sent to `POST /api/seasons/active/ratings` (`{anime_id, grade, rated_at}`, absolute, identical resend is a 204 no-op). Per round, one held row per anime: `update` rows go in one reconcile (the first round always reconciles, it is the pull); a failed reconcile releases that round's ratings unsent; ratings are then sent oldest first, each settled compare-and-set, and only a 204 chains the key's successor. Fates: 204 `synced`; 401/404/409/other 4xx `dead_letter` with `auth_repair`/`not_found`/`conflict`/`rejected`; transport/5xx `pending`. Unresolved keys come in two kinds on the same anime claim, `anime` and `season_rating {seasonId, animeId}`, because a confirmed edit of one kind never supersedes a given-up value of the other (R-16); auto-resolution stays within a kind. Every "unconfirmed anime edit" predicate (merge skip, heal skip, fetch-first give-up, anime supersession) filters `operation='update'`. Kotlin does not refresh the season (JS owns `active_season_cache`); `app_active` joins the refresh reasons. Migration: a repair step moves `season_rating_queue` rows in order (`failed` with an unresolved kind becomes `dead_letter`, everything else `pending`, claims cleared) and drops the table in one transaction, idempotent; journal 0019 raises readiness to 20 in both runtimes, so background sync waits for the first app open after the update. No in-place APK downgrade. Units: U1 Kotlin sender, U2 JS, U3 migration (verified alone), then one verifier over U1+U2.
- **L29 (2026-10-16, T13 copy confirmed):** The maintainer, verbatim: "Sí, los textos están bien, déjalos así." The reachable-with-pending copy "Bridge conectado" / "Por enviar" / "Tienes N cambios guardados en este dispositivo. Se enviarán en el próximo sync." stays.
- **L30 (2026-10-16, T17 closed):** `9b91d75` U1 Kotlin rating sender; `c40c739` U2 JS ratings in `operation_log` (old queue readers and writers removed, the 8 rating contract fixtures run in both runtimes); `846b2fa` U3 repair-step move + migration 0019, readiness 20 in both runtimes. U3 verifier: PASS on a real v1.12.0-shaped device (readiness 18, 0009 queue shape) through drizzle's real gate; no loss, duplicate or startup failure, 2000 rows in order; its probes committed as `e3b47d0`. U1+U2 verifier: wire body, fates, predicate classification, unresolved, status/UI and anime-only differentials PASS; B1 (Kotlin left a mixed round's ratings `processing` after a local failure) and B2 (a failed rating write left the row `processing` in JS and failed the attempt in Kotlin) fixed in `d8a26a3`: the row is released to `pending`, the pass continues, and every row the attempt claimed is released on failure, compare-and-set on the claim. Scoped recheck PASS; its takeover probes committed as `dff41c0`. The 46 unrelated Kotlin failures in one run were caused by a scratch Gradle build writing through a `node_modules` junction at the same time; 3 isolated `--rerun` runs were 426/426. Advisories: the pre-send claim re-check is not atomic with the POST (worst case an identical resend, a 204 no-op); keep_bridge on an anime key leaves its queued ratings, likely to end `not_found`; a Kotlin 404/409 on a rating sends no broadcast, so JS refreshes the season on the next `app_active`; moved ratings keep their old `created_at` and are pruned right after sync; `odd/tasks/sync-core-test-assurance.md` tier list still names the old queue helper. Next: T16 (S14).
- **L31 (2026-10-16, T16 closed):** `2736b65` removed about 2,600 lines nothing reached: the incremental sync handler, the initial-sync hook, the in-flight guard and staged mode of `syncPendingOperations` (single-flight `requestFlush` already serializes), JS `pruneOperationLog` (only Kotlin prunes, C2), `drainedCount`, cycle-active bookkeeping and the convergence module, unused bridge/ticker calls, native `SyncEngine.runOnce` with its main-process guard (the FGS and floor worker run in `:sync` and never used it), headless startup, and 10 tests a contract fixture pins in both runtimes. Verifier: PASS, every removed symbol unreachable at baseline, 7 mutations on the deleted-test behaviours all killed, fixtures 36/36 JS and 35/35 Kotlin. Kept with reason: rating `failed` projection (live), A5 no-base branch (needs a typed sendable operation), `normalizeFetchedAnime` (identity, fixtures to rewrite), the Kotlin journal `pruned` state, wire stage names. Open decision for the maintainer: since 1.7.0 nothing writes `is_cycle_active=true`, so `consecutive_unclosed_cycles` and `never_closed` are always 0 and several diagnostics columns have no writer, and the JS telemetry/in-memory diagnostic log has no production caller; remove them or give them a real writer. All tasks T1-T17 done.
- **L32 (2026-10-17, dead diagnostics: remove):** The maintainer, verbatim: "Bórralo entonces." Context: the `is_cycle_active` / `consecutive_unclosed_cycles` / `never_closed` signal was built for the retired JS headless task and has had no writer since 1.7.0; the Kotlin engine already marks an unfinished cycle `abandoned` in its journal and returns its rows. The JS in-memory diagnostic log has no production caller. Both go completely (no-legacy rule), with the columns that have no writer. New task T18.
- **L33 (2026-10-17, T18 closed):** `f22527d` removed the never-closed signal, the JS diagnostic ring and the never-wired JS cycle telemetry (reconcile wire byte-identical), moved device check 10 to the Kotlin journal, and dropped the 27 `sync_runtime_status` columns nothing reads (0020 drops the 23 a fresh install has; a repair step drops whichever an installed device has, in one exclusive transaction); readiness 21 in both runtimes. Kept: id, registration_status, execution_mode, can_show_persistent_notification, last_attempt_at, last_success_at, last_cycle_id, last_cycle_stage, last_error_name. Code and migration landed in one commit because they were interleaved. Verifier: PASS on v1.12.0 (readiness 18) and readiness-20 devices through the real gate, fresh install same shape, Kotlin refuses below 21 and recovers on the next tick, no dropped column read anywhere including the bridge, wire identical. A1 (check 10 counted `not_applicable` as unfinished) and A2 (a rejected remote change left no JS trace) fixed in `ca73da0`. Open: nothing reads Kotlin `CycleOutcome.syncedCount`/`backlogReadCount` outside tests; no device run yet.
