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
    - a rejection. If that row is given up, the rows behind it are held.
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
| T1 | S15 | inline | none (docs) | pending | |
| T2 | S1 | inline | 6 | pending | |
| T3 | S2 (schema), S3 (schema), S7 (schema) | inline + verifier | 1 (migration) | pending | |
| T4 | S2 | inline + verifier | 4 (concurrency) | pending | |
| T5 | S3 | inline | 3 | pending | |
| T6 | S4 | inline + verifier | 4 | pending | |
| T7 | S5 | inline + verifier | 1 (clears data on unpair) | pending | |
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
- **Next:** T1.
