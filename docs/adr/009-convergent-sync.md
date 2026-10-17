# ADR 009: Convergent Sync

## Status

**Accepted 2026-10-16.**

The maintainer took the decisions below one at a time. The proposal was then revised twice, and in its eighth draft both blind judges of a two-round dual review confirmed every finding resolved. Implementation is tracked as ODD feature `convergent-sync` (`odd/tasks/convergent-sync.md`).

**This ADR amends ADR 008, decision 3** ("writes have a single owner per store, with lease and fencing"), for `operation_log`. JS is no longer required to own that store under the lease. Instead, compare-and-set transitions and per-key claims protect the rows (R-13), and the native lease stays in place for native attempts. The other decisions of ADR 008 stand.

## Context

`docs/sync-architecture-audit.md` mapped the sync system and found the following problems:

- **No shared pattern.** Six drainers exist and no registry links them. Season ratings have no kick and no native sender (I1). Triggers bypass the coordinated cycle (I2, I8).
- **Outbox holes.** The outbox sends the oldest row first, so an overlap between JS and Kotlin can lose the latest intent.
- **Silent drops.** Given-up changes disappear without a trace.

The user reports that sync works today in practice. The task is therefore to **polish the existing design toward a named pattern, not to rebuild it.**

Three facts come from the bridge team, who read their code; none is pinned by a test yet:

- Reconcile carries absolute fields and no operation id.
- An identical resend is a no-op.
- A stale `base` produces a conflict row, and a missing `base` falls back to last write wins.

## Decision

The architecture is named **convergent sync**. It combines five standard patterns:

- a Transactional Outbox;
- an Idempotent Receiver (the bridge);
- notify-then-pull over the WebSocket;
- a changes feed with a forward-only cursor;
- anti-entropy (the snapshot heal and the staged drain).

### Maintainer constraints

1. **Events, not loops.** In the maintainer's words: "me parece mejor que reaccione por eventos a que reaccione por loops". An interval may filter events, but it is never a timer.
2. **Two runtimes and two dispatchers, one per process.** JS runs only in the foreground and has no background responsibility. Kotlin (`:sync`) runs always, including while the app is open. This overlap is deliberate and is made safe by R-13; the runtimes never signal each other.
3. **One exit per runtime.** The model is an HTTP interceptor: a request may originate anywhere, at any time, but every request leaves through one place.
4. **Events are never coalesced.** The maintainer states that the bridge builds its history from every event. This was not verified in the bridge code.
5. **The three queues keep their tables:** `operation_log`, `season_rating_queue`, and the diagnostics outbox in `telemetry.db`.

### Rules

| Rule | Requirement |
|------|-------------|
| R-1 Durable | Every intent is written durably in the same transaction as its local change. This holds today. |
| R-2 Every kind, every path | Kinds are registered once. Callers enqueue their intent and call `requestFlush(reason)`. Only the dispatcher sends, through `BridgeClient` (JS) or `SyncEngineHttp` (Kotlin). Triggers follow the same rule, so WebSocket `season_changed` and `preferences_changed` also go through the entry point. |
| R-3 Absolute + base | Every message carries absolute state and a `base`; a send without `base` is forbidden. Every path that writes an anime also stores its `bridge_modified_at`. When the token is missing, the claim holder fetches it first and stores **only the token**. The fetch has four outcomes, listed below the table. |
| R-4 Receiver idempotent | Identical repeats are no-ops. This is pinned in the shared contract fixtures. |
| R-5 Per-message failure | One failing message never blocks the others. Each failure class has exactly one fate, and that fate is the same in both runtimes. |
| R-6 Forward-only cursor | Both runtimes persist `MAX(stored, next)`. |
| R-7 Anti-entropy | The heal runs on mount, on resume, and on WebSocket reconnect. The reconnect catch-up is bounded in three ways, listed below the table. |
| R-8 Retry is always alive | Some path always retries pending intents. Tearing down the ticker must not remove the only retry path. |
| R-9 Status tells the truth | What the UI shows matches reality. |
| R-10 One vocabulary, one contract | Shared fixtures pin each rule once for both runtimes. |
| R-11 Clean lifecycle | Unpairing clears every queue that belongs to the old pairing, and clears the bridge tokens. |
| R-12 No dead paths | Every path is reachable, and every write is read. |
| R-13 Guarded transitions | Every status change is compare-and-set. A runtime never reverts a row that the other runtime already confirmed. Work is claimed per queue key, using the claim mechanism listed below the table. |
| R-14 Every event, in order, chained | The claim holder sends the oldest row, waits for its confirmation and its new token, then sends the next row. The stop conditions are listed below the table. |
| R-15 Re-base on conflict in both runtimes | Every conflict re-bases. After 3 consecutive conflicts in which the token does not advance, the row becomes `conflict_exhausted`. Kotlin persists the conflict token and the attempt count. |
| R-16 Nothing dropped silently | (a) A remote change skipped by `defer_outbox` is never lost behind an advancing cursor. (b) Every terminal outbound failure becomes a durable unresolved state, under the contract listed below the table. |

**R-3: the four fetch outcomes**

| Outcome | What happens |
|---------|--------------|
| Bridge unreachable | The row stays pending. This is not a conflict. |
| 404 | The key becomes unresolved. |
| Token returned | The row is sent. |
| Anime returned with no token | The key becomes unresolved, and the event is logged. |

**R-5: one fate per failure class**

Both runtimes apply the same fate to the anime outbox; JS applies it to season ratings too, since only JS sends them. Added 2026-10-16 with task T10.

| Failure class | Fate |
|---------------|------|
| Network error or timeout | The rows stay `pending`; the attempt fails. |
| 5xx | The rows stay `pending`; the attempt fails. |
| Malformed response | The rows stay `pending`; the attempt fails. |
| Local write failure | The rows stay `pending`, released or retaken when their claim expires; the attempt fails. |
| 401 | Terminal (I3): every row of the request becomes unresolved (`dead_letter`; a rating `failed` with `auth_repair`). A 401 rejects the pairing, never a message, so it is never isolated. The attempt fails. |
| Any other 4xx (400, 403, 404, 409, 422, ...) | The message is rejected, so it becomes unresolved (`dead_letter`; a rating `failed` with `not_found`, `conflict` or `rejected`). When the request carried several messages, they are re-sent one per request first, so only the message that caused it takes this fate. |
| A message rejected inside a 2xx (`applied: false`) | The conflict rule (R-15), or `dead_letter` for an unsupported operation; only that key stops. |

When a rejected request of several messages is re-sent one per request and at least one of them gets through, the attempt does not fail. A season rating never fails the foreground cycle (I4): a rating left `pending` only keeps the cycle from reporting success.

**R-2: one entry point, one exit per runtime**

Added 2026-10-16 with task T11.

- **JS entry point.** Callers write their intent durably, then call `requestFlush(database, reason)` (`sync-flush.helpers.ts`): the episode and estado mutations, a season rating (I1, JS half), every runtime trigger, and the WebSocket `season_changed` and `preferences_changed` events (I8). Switching season mode off is only a local clear; it sends nothing.
- **Single flight.** One cycle runs per database. A request during a running cycle schedules exactly one follow-up, which every later request joins; cycles never overlap.
- **JS dispatcher.** The foreground runtime registers the coordinated cycle (`runCoordinatedForegroundSyncCycle`) as the only dispatcher while it is mounted. That cycle is the one place the JS kinds are listed, in send order: anime operations (whose pass also carries the diagnostics outbox), then season ratings, then the active-season refresh. The episode kick runs it too (I2), so it drains ratings, records started and succeeded status, and can reach `online`. With no dispatcher registered, a request sends nothing: the rows wait for the native engine or the next foreground trigger.
- **Kotlin exit.** Every request of the `:sync` process leaves through `SyncEngineHttp`, the diagnostics courier included.
- **Pinned by** `tests/features/sync/single-exit.architecture.test.ts`: each drain and each `BridgeClient` send method has exactly one caller, and only `SyncEngineHttp.kt` opens a connection.
- **Not yet:** the native rating sender (I1, Kotlin half) lands with T17, when ratings move into `operation_log` and the Kotlin dispatcher sends them from there.

**R-7: bounds on the reconnect catch-up**

- It is single-flight.
- It always pulls the changes since the cursor and drains the staged changes.
- It runs the full snapshot only when the last successful heal is more than 5 minutes old. A failed heal does not reset that interval.
- It does not repeat the mount heal.

How JS implements it (task T12, 2026-10-16):

- Every heal goes through `requestFlush`. Each flush reason carries a snapshot-heal demand (`SNAPSHOT_HEAL_FLUSH_DEMANDS`): `bootstrap` (mount) and `app_active` (resume) always heal, `ws_reconnected` heals only when the last successful heal is stale, and every other reason never heals. A run that absorbs several reasons serves the strongest demand. Single-flight therefore comes from the dispatcher: one cycle runs, plus at most one follow-up.
- The dispatched cycle sends, refreshes the season when asked, and then heals. The heal is best effort. A cycle whose sends failed skips the heal. A mount or resume cycle starts the cover sweep after its heal; the cover hydrate stays on the mount and resume events.
- The last successful heal is kept in memory, per database. It only has to outlive a resume within one process, and a cold start always heals on mount. A failed heal never writes it.
- `useWebSocket` reports `onReconnected` only for opens after the first one of a connection session. A session starts on mount or resume, which already flushed.

**R-13: the claim mechanism**

- The queue key is the anime for `operation_log` and the season for `season_rating_queue`.
- Each claim records an owner and a time, stored in added columns. Adding columns migrates no data.
- The other runtime skips any key with a live claim. It does not wait.
- A claim expires after 60 s.
- The holder re-checks its claim before each send.
- Recovery resets only expired claims.

**R-14: the chain stops when**

- **a row is rejected.** The rest of that key waits for the next cycle. A row that is given up never holds the rows queued behind it: every event is an absolute `update` (it sends `episodesWatched: 7`, never "+1"), so a later event never depends on an earlier one. Holding them would lose the later events too and freeze the anime with no way out. The given-up row itself becomes unresolved (R-16(b)). Amended 2026-10-16 by the maintainer.
- **there is a network error or timeout.** The row stays pending, and the error is not counted as a conflict.
- **20 s have been spent chaining in one cycle.**

The claim is released when the chain stops.

**R-16(b): the unresolved contract**

- **Which failures:** `dead_letter`, `conflict_exhausted`, rating 404/409, and the R-3 outcomes 404 and no-token.
- **Merge and heal:** an unresolved key never blocks; both treat it like any other key. A later local edit of that key confirmed by the bridge resolves it automatically, and every automatic resolution is logged with its reason. Amended 2026-10-16 by the maintainer: holding the key would freeze the anime with no way out while the UI is a separate track.
- **Status:** status counts unresolved keys.
- **Retention:** an unresolved key is never pruned. Its `dead_letter` and `conflict_exhausted` rows, and its rating rows, stay until the key is resolved, automatically or through the entry point. Only `synced` rows keep the 7-day / 1000-row cleanup, in both runtimes. Amended 2026-10-16 by the maintainer: the earlier 30-day / 500-row cleanup of given-up rows would drop an unresolved key silently, which R-16 forbids.
- **Resolution:** there is one entry point, and it acts on the whole key.
  - Keep local: release the held rows and re-chain them from a fresh base.
  - Keep bridge: drop every row for the key and apply the remote state.
  - For the 404 and no-token outcomes, only keep bridge is offered. A 404 uses the delete rule.
- **UI:** the user interface is a separate design track.

### Rejected

- **One table with a `kind` column.** It needs a data migration. The diagnostics outbox also lives in a separate database file, and the change would be a rebuild.
- **Splitting JS and Kotlin by app state** (draft v3). The transitions were unfenced in both directions, delivery would starve while the app stays open, and native "foreground" and JS "active" disagree.
- **Coalescing queued events.** It conflicts with constraint 4.
- **Accepting last write wins when `base` is missing.** It was rejected in favour of fetch-first (R-3).
- **A fixed conflict cap.** It could abandon a valid change while the anime is being edited on the desktop.
- **A periodic foreground drain.** It is a loop.
- **A new cross-process signal from `:sync` to JS.** The old `onTick` channel was retired, and the case is too rare to justify a new one.

## Consequences

1. **Throughput rises sharply.** Ten offline edits to one anime currently take about 17 minutes: native ticks were observed about 105 s apart on 2026-10-16. With chaining they take well under a second, since a reconcile takes 4–34 ms at the bridge.
2. **Schema change.** `operation_log` and `season_rating_queue` gain claim columns, and they need a durable representation of the unresolved state. The migration must respect the single-scalar ledger gate (`docs/mobile-database-recovery.md`).
3. **New failure surface.** A given-up change no longer disappears silently. It surfaces as a counted, durable unresolved key, which now needs a UI (separate track).
4. **Copy follow-up.** User-facing copy will name the desktop app "Bridge", never "PC". That migration is a separate change.

## References

- `docs/sync-architecture-audit.md`: the evidence (corrected on 2026-10-16).
- `odd/tasks/convergent-sync.md`: the implementation tasks.
- ADR 008: decision 3, amended here.
- `openspec/changes/archive/2026-09-04-anime-occ-token/`: the original OCC token design. Its invariant "omit `base` when the token is unknown" is superseded by R-3.
