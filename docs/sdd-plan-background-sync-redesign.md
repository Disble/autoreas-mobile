# SDD Execution Plan — Mobile ↔ Bridge Background Sync Redesign

**Status:** Draft, 2026-09-04.
**Source of scope:** `docs/mobile-bridge-background-sync-redesign.md` (§12 phases 0–5) and `docs/adr/007-measurement-gated-background-sync.md`.
**Repositories in scope:** `autoreas-mobile` (this repo) and `autoreas-bridge` (peer session `team-bridge`).

This plan turns the six design phases into named SDD changes across two repositories, orders them by evidence rather than by appetite, and states which readings gate which scope.

## SDD Session Preflight

| Setting | Value | Consequence for this plan |
|---|---|---|
| Execution mode | `auto` | Phases run back to back; the gatekeeper validates each phase artifact before the next launches. |
| Artifact store | `hybrid` | Every change writes `openspec/changes/<slug>/` **and** Engram topic keys `sdd/<change>/…`. The repo already carries `openspec/specs/`, so file artifacts are part of project truth, not a duplicate. |
| Delivery strategy | `auto-chain` | A phase whose forecast exceeds 800 changed lines is split into sequential SDD changes without stopping to ask. Delivery is local merge to `main`, no PRs — chaining means ordered changes, not stacked branches. |
| Review budget | 800 changed lines | Includes the JSDoc debt that CLAUDE.md constraint 12 attaches to every staged file. Budget the debt, do not discover it. |

`chain_strategy` is not collected yet. It is only consulted if chained delivery ever means branches; under a local-merge model it does not, so the chain is expressed as change order.

---

## 1. The rule this plan obeys

Three prior designs (2026-04-10 ×2, 2026-07-16) each picked a keep-alive mechanism and shipped it without measuring which mechanism was actually delivering. All three failed. The single structural defence against repeating that is:

> **No SDD change is scoped before the reading that gates its scope has been taken.**

Applied to the plan itself, this has a consequence that is easy to miss: **the first SDD change is not the first action.** Four operator readings and two `adb` commands cost roughly thirty minutes, require no build, and can retire hypotheses that otherwise dictate weeks of construction. They come first.

Evidence classes carry through from the design: `(device)`, `(source)`, `(bridge)`, `(docs)`. As of this writing **`(device)` is empty** — nothing in the redesign has been measured on a phone.

---

## 2. Gate 0 — work that is not an SDD change

Nothing here touches production code, so none of it is an SDD change. All of it blocks the changes that follow.

| ID | Action | Cost | What it settles |
|---|---|---|---|
| G0.1 | Settings → read `last_failure_message` and `last_trigger_source` (O1/O2) | 1 min | Can retire H01c or H06a outright, which shrinks change **MB-0c**. If `last_trigger_source` reads `background_task`, H06h moves from source-plausible to device-corroborated. |
| G0.2 | Android version, manufacturer, model (O3) | 1 min | H03. If API < 35 the 6 h `dataSync` cap does not bind on this device and **MB-2c** is re-evaluated against a simpler always-on option (§8.5 branch table). |
| G0.3 | Installed APK build date and origin, local vs EAS (O4) | 2 min | H05b. Decides whether the ticker module is even present in the failing build — if it is not, the July 2026 fix was never tested and **MB-2c** shrinks to a rebuild. |
| G0.4 | `adb logcat -s BackgroundTaskWork:V BackgroundTaskScheduler:V JobServiceContext:V WM-WorkerWrapper:V` plus `dumpsys jobscheduler`, ~15 min window (a17) | 20 min | **H06h — the leading root cause.** One reading confirms or kills it. |
| G0.5 | `adb shell am get-standby-bucket` and `dumpsys usagestats` after an overnight idle (a18) | 2 min + one night | **H16.** If the device sits in RARE/RESTRICTED with background network disabled, R1 is unachievable while locked and the guarantee must be re-scoped before **MB-2** is built at all. |
| G0.6 | One fresh independent review lens over §8.6 and §11–§14 | one agent run | Closes the review gap declared in §15. §8.6 drives **MB-3**, §11 drives the entire bridge chain, §12 drives this plan. ADR 007 cannot reach Accepted while it is open. |

**Refinement against the design document, stated as mine:** §12 places a17 and a18 inside Phase 1 and makes Phase 1 depend on the Phase 0 build being installed. That dependency does not hold for these two scenarios. Both read OS-level tags — `expo-background-task`'s own Kotlin logging, WorkManager's worker wrapper, and the standby bucket — against whatever APK is currently installed. Neither needs the `SyncTrace` subsystem. Measuring the *failing* build is in fact more informative than measuring a repaired one, because H06h is a claim about what the failing build does. They move to Gate 0.

G0.1–G0.5 are the operator's; G0.6 is an agent run and can proceed in parallel.

---

## 3. Mobile change ledger

Change slugs follow the repo convention `YYYY-MM-DD-<slug>` (see `openspec/changes/archive/2026-08-12-sqlite-write-lock-contention`). The date is stamped when the change folder is created, so slugs are given without it below.

| ID | Slug | Scope | Gated on | Est. |
|---|---|---|---|---|
| **MB-0a** | `background-sync-bounded-awaits` | **R8.** `AbortSignal` timeout on every `BridgeClient` request; a cycle deadline shorter than the host job's runtime limit; a settle guarantee on the write-door chain so every queued write resolves or rejects. Plus **D8** — `minimumInterval: 15` (the 900-minute constant), one token, adjacent and required for any baseline to mean anything. | G0.4 | ~500 |
| **MB-0b** | `sync-trace-observability` | **D2.** New `src/features/sync/sync-trace/` via `npm run generate:feature`: append-only trace, three clocks (`wall` / `elapsedRealtime` / `uptimeMillis`), build sha, its own file contract and immediate-flush policy, ring buffer. `correlationId` extension of `BridgeRequestSpec` / `buildBridgeHeaders` inside `src/infrastructure/api/**` emitting `X-Sync-Cycle-Id`. Settings export. | G0.1 | ~700 |
| **MB-0c** | `durable-reconcile-footprint` | **D1.** Post-`202` cursor advance and op confirmation in one transaction with a typed `phase` / `stage` failure taxonomy. `sync_quarantine` table — schema, `REQUIRED_SCHEMA_TABLES`, migration — **created but not yet advancing the cursor**. A10 upsert-on-unknown-`_id` in transaction B. Remove the dead `409` branch (H13). notify-kit `FG_TIMEOUT` handling. T1/T2/T4/T5. One `ARCHITECTURE.md` sentence recording the second database file. | G0.1, **BR-A2** | ~800 |
| **MB-1** | `android-measurement-lab` | `tests/android-lab/` harness plus the remaining scenarios a01–a22, mirroring `tests/sqlite-lab` conventions: named hypotheses, `CONFIRMED / FALSIFIED / NOT_FALSIFIABLE` verdicts, mandatory environment record. One campaign on the operator's device. Bridge histogram re-run. | MB-0a…0c installed | ~400 |
| **MB-2a** | `sync-policy-and-status` | **D6** `SyncPolicy` yielding a `SyncDecision` value with blocker reasons; **D10** `RuntimeStatusView` deriving every user-visible flag from trace plus OS queries, never from closure booleans (R4). | MB-1 verdicts | ~700 |
| **MB-2b** | `outbox-flush-job` | **D3.** Local Expo module implementing `TaskConsumerInterface`, registered through `TaskManagerInterface.registerTask`, reaching JS through expo-task-manager's existing headless executor. One-time, network-constrained WorkManager request, expedited when quota allows. | MB-1 verdicts for H04, H06h, H16 | ~800 |
| **MB-2c** | `foreground-session-budget` | **D5** FGS as an explicit, budgeted session started only from the foreground and stopped when idle, its OS stop observed both via `FG_TIMEOUT` and by polling `ActivityManager`; **D7** the native ticker retained only inside that session. | MB-1 verdicts for H03, H05, H09 | ~600 |
| **MB-3** | `websocket-single-owner` | **D9** mobile side: one `SocketOwner` per runtime with a monotonic generation checked in *every* callback; 90 s read-idle timeout; close codes `4000` / `4002`; existing backoff preserved, only its guard moved behind the generation check. | G0.6, **BR-B1** | ~400 |
| **MB-4** | `doze-escalation` | **D4**, contingent. Battery-optimization exemption flow first; `connectedDevice` FGS evaluation only if a12 still fails. | a12 failure **and** a18 | ~500 |
| **MB-5** | `retire-perpetual-ticker` | Remove the ticker as default engine. Repoint every `sync_runtime_status` consumer to `RuntimeStatusView` **while retaining the table and its writes** — it is in `REQUIRED_SCHEMA_TABLES`. Update `ARCHITECTURE.md`; ADR 007 → Accepted; archive the April/July superseded assumptions. | MB-2*, MB-3 | ~400 |

### 3.1 The MB-0a / MB-0b ordering is itself measurement-gated

R8's acceptance criterion is written in trace terms: *zero cycles with `cycle_started` and no terminal event*. That criterion cannot be evaluated before `SyncTrace` exists. So the order is not free:

- **If G0.4 confirms H06h** — a job timeout line every ~600 s in `logcat` — then the field evidence already exists without the trace. **MB-0a ships first**, verified by unit tests plus a repeat of a17 showing the timeout line gone. This is the fastest path to relief for the user, and it is available only because the reading was taken.
- **If G0.4 is inconclusive** — no timeout line, or the worker never appears — then **MB-0b ships first**, because otherwise there is no instrument capable of telling whether MB-0a changed anything. Shipping the fix before the instrument is the precise error of the three prior designs.

MB-0c follows either way.

### 3.2 Budget notes

Estimates include test files under `tests/features/sync/__tests__/` (TDD mandate, constraint 4) and the JSDoc that constraint 12 forces on every staged file. `MB-0c` and `MB-2b` sit at the 800-line line; if their tasks forecast exceeds it, `auto-chain` splits them — the natural seam in MB-0c is *(transaction + taxonomy)* / *(quarantine table + hygiene)*, and in MB-2b *(native module)* / *(JS scheduling policy)*.

---

## 4. Bridge change ledger

Owned by the peer session `team-bridge`, repo `D:\dev\disble\autoreas-sp\autoreas-bridge`. Proposal IDs are §11's.

**Reviewed by `team-bridge` on 2026-09-04.** Their findings are folded into the rows below. Two corrections to an earlier draft of this section are recorded in §4.1, because both were cases where this plan was wrong rather than merely incomplete.

**Authorization is not technical readiness.** An earlier draft called BR-A1/A2/A3 "ungated", which conflated two different things: nothing *technically* blocks them, but a peer session does not decide to start work in a repository it does not own. All three wait on the `autoreas-bridge` owner's decision. "Ungated" below means only that no other change in this plan has to land first.

| ID | Proposals | Gated on | Note |
|---|---|---|---|
| **BR-A1** | **B6** — stop persisting the `Authorization` **value** in `request_captures.request_headers`. | **Implemented 2026-09-04** by `team-bridge` on branch `test/bridge-sync-contract-fixes`, owner-authorized, not merged to `dev`. | Shipped as a denylist that **redacts the value and keeps the key** (`Authorization: [redacted]`), not the key-dropping denylist this plan originally prescribed. `team-bridge`'s divergence and its reasoning are recorded in §4.2 — it is the better decision and this plan defers to it. Pinned by `TestSanitizeHeadersKeepsUnknownCustomHeadersVerbatim`, which asserts `X-Sync-Cycle-Id` and `X-Sync-Generation` survive verbatim. |
| **BR-A2** | **B4** — document `applied_operations` semantics in `docs/openapi.yaml`. Verified semantics, supplied by `team-bridge`: **always present, serializes as `[]` and never `null`**, one entry per operation *sent*, in order, `applied: false` for an unsupported operation or an `AnimePatchOutcomeConflict`. | repo owner decision | **Pulled before MB-0c.** Mobile's confirmation rule in MB-0c is built directly on these semantics; building it against an undocumented contract is how the current drift happened. Docs only. The `[]`-never-`null` guarantee is load-bearing for MB-0c's parse step and was not in the earlier draft. |
| **BR-A3** | **B3** — return the device's acknowledged cursor instead of `MAX(id)=0` when the changelog is empty after prune. | nothing | Order-free in both directions: mobile's `shouldPersistLastChangelogId` already refuses any non-advancing value, so an unchanged mobile is unaffected. Protects future clients. |
| **BR-B0** | **B0** — decide who owns liveness detection. | G0.6 | **A decision, not code, and it blocks BR-B1.** As written, B1 gives the bridge a 30 s ping while §8.6 gave mobile the same, so both sides would ship a keepalive and each could declare the other dead on the same timer. Proposed split: the bridge pings and owns the verdict; mobile only answers and keeps a 90 s read-idle timeout. Settle it in conversation with `team-bridge` before either side writes code. |
| **BR-B1** | **B1** — server ping every 30 s, 10 s pong deadline, `SetReadDeadline`, close with a code. **B2** — dedupe by `device_id` with the mobile generation token as tiebreak, close superseded with `4001`, record code and reason in `ws_disconnect.outcome`. **Plus a capture-schema addition, added at `team-bridge`'s request — see §4.1.** | BR-B0 | Ships **before** MB-3. B1 is order-free (an unchanged mobile answers protocol-level pongs automatically). B2 shipped alone degrades gracefully to arrival-order eviction, which already beats today's 67 zombies. Three implementation constraints from `team-bridge`'s reading of the vendored gorilla/websocket v1.5.3 (`doc.go:124-134`), recorded here because they compile, pass a single-client test, and fail in production under fan-out: **(a)** the ping ticker must use `conn.WriteControl(websocket.PingMessage, …)`, which is safe concurrently — `WriteMessage(PingMessage, …)` is not, and would corrupt the stream against hub broadcasts; **(b)** `SetReadDeadline` is a *read* method, so rearming it from the ticker goroutine races `ReadMessage`; arm it once before the loop and rearm inside `SetPongHandler`, which gorilla invokes on the reader goroutine; **(c)** `Send` already holds `c.mu` for `SetWriteDeadline` + `WriteMessage`, and the `WriteControl` ping does not need that mutex. |
| **BR-C** | **B7** — device heartbeat timestamp independent of reconcile ack. | MB-0b | Optional. Only becomes useful once mobile stamps `X-Sync-Cycle-Id`. |

**B8 is deliberately not proposed.** An `update` for a record the device has never seen is dropped by mobile's partial `UPDATE` (A10). That is a mobile defect and is fixed in MB-0c. Asking the bridge to change a wire contract to compensate would be the wrong repair. `team-bridge` concurs, and records the `change_type: "update"`-for-a-creation imprecision as bridge debt rather than as a mobile dependency.

### 4.1 Two corrections from the `team-bridge` review

**(1) BR-A1 as written would have destroyed the correlation this plan is built on.** `(source)`, verified in `autoreas-bridge` by this session, not taken on report.

`sanitizeHeadersWithConfig` (`internal/observability/requestcapture/telemetry.go:63`) ignores its `config` argument entirely and copies every header through; its own comment states the parameter "is retained only for API compatibility with existing tests/callers." That is *why* custom headers survive today — not because they are permitted, but because nothing is being filtered. The allowlist still exists, unapplied, in `defaultSanitizerConfig` (`telemetry.go:20`), and contains exactly `content-type`, `content-length`, `accept`, `x-sync-version`, `x-app-version`, `x-client-version`, `x-api-version`. It contains **neither `x-sync-cycle-id` nor `x-sync-generation`**.

So the most natural way to implement B6 — re-enable the default-deny that is already written — drops the bearer token **and** MB-0b's join key **and** B2's generation tiebreak, in one commit. The failure is silent: nothing errors, and the first symptom is the histogram in S4 coming back with empty columns, long after the change landed.

This plan's earlier §5 claimed "no bridge change is needed to correlate." That was true of the bridge as it stands today and false as soon as BR-A1 ships. The correction: **BR-A1 must be a denylist**, dropping `Authorization`, `Cookie` and `Proxy-Authorization` and passing everything else. An extended allowlist is the wrong shape here because it has to enumerate headers that do not exist yet — MB-0b's and MB-3's — and when it fails to, it fails silently in exactly this way.

**(2) B2's eviction cannot be evaluated under the current capture schema.** `(bridge)`, measured by `team-bridge`.

`ws_connect` / `ws_disconnect` rows carry only `device_id`, because `deviceIDFromClientID` (`internal/realtime/hub_capture.go:65`) splits `<deviceID>-<sequence>` and discards the sequence deliberately. With concurrent sockets per device, connects and disconnects are unpairable by construction: pairing each connect with the next disconnect for the same device across 188 connections uses only 119 distinct closes, making **69 of 188 pairings spurious — 37 % of that distribution is manufactured by the heuristic.**

The consequence for B2 is direct. Superseded closes become countable as *events* but not attributable to a socket, so the two questions the generation tiebreak exists to answer — "how long did the socket I evicted live?" and "did I evict the healthy one or the zombie?" — remain unanswerable after the fix ships. **BR-B1 therefore also persists the hub client id or the generation on the capture row.** It is the same change; without it, B2 is a fix whose effect cannot be measured, which is the failure mode this entire redesign exists to stop.

A third note from the same review is not a defect but would read as one: **B1 will raise the disconnect count, but by about 55 % in that one kind — not by an order of magnitude.** An earlier draft of this section carried the order-of-magnitude figure; `team-bridge` retracted it and the correction is worth keeping visible, because the ceiling is arithmetic rather than empirical: **a socket closes at most once, so disconnects can never exceed connects.** Measured over the retained window (40.3 days, 2026-07-25 → 2026-09-04, 1446 rows total):

| kind | rows | % | per day |
|---|---|---|---|
| `reconcile` | 520 | 36.0 | 12.9 |
| `get` | 335 | 23.2 | 8.3 |
| `ws_broadcast` | 277 | 19.2 | 6.9 |
| `ws_connect` | 189 | 13.1 | 4.7 |
| `ws_disconnect` | 122 | 8.4 | 3.0 |
| `post` | 3 | 0.2 | — |

With B1 closing every zombie, `ws_disconnect` rises from 122 to at most 189 over that same window: **+67 rows, +1.7/day, +55 % in that kind and about 5 % of the total.** The only route to a genuinely large increase is mobile reconnecting more often once it detects death sooner — which is a mobile-side decision, not a consequence of B1.

**Capture retention bounds the measurement campaign, and the binding constraint is mobile's own sync rate.** The 5000-row limit has never pruned: 1446 rows over 40 days means the window is bounded by how long this schema has been running, not by pruning, leaving roughly 139 days of headroom at the current 35.9 rows/day. A new APK that reconciles every 10 minutes sustained would write ~144 rows/day and cut that to about **35 days**. Still ample for a diagnostic campaign, but it is the number to watch, and MB-0a's `minimumInterval` repair plus MB-0b's tracing are exactly what move it. `defaultRetentionLimit` is a one-line change in `internal/observability/requestcapture/types.go` if the window ever needs extending.

**The contract-fixes branch does not touch capture schema or retention** — verified by diff against `CREATE TABLE`, `RetentionLimit`, `defaultRetentionLimit`, `PruneEvery` and `ALTER`. Five files changed: `telemetry.go` (+test), `sync/service.go` (+test), `openapi.yaml`. Only four credential header *values* change in a capture row; columns, indexes, the 5000-row limit and the `PruneEvery` of 100 are identical. The evidence channel is intact.

Finally, `team-bridge` accepts the 30 s / 90 s split of BR-B0 but flags that **30 s is a convention, not a measurement**, and that the connection-lifetime distribution that would justify it cannot be produced from the current schema — for the reason in (2) above. It is not worth manufacturing; the interval stands as a convention, and correction (2) is what would eventually let it be measured.

### 4.2 `team-bridge`'s divergence on BR-A1, and why this plan defers to it

This plan prescribed a denylist that **drops** `Authorization`, `Cookie` and `Proxy-Authorization`. `team-bridge` implemented a denylist that **redacts the value and keeps the key**:

```
Authorization: [redacted]
X-Sync-Cycle-Id: 01JD8Z2K7QW3
```

**Their reasoning, which is better than the original prescription.** The header passthrough was not an oversight to be reversed. It entered deliberately on 2026-07-25 in `fix(activity): unify runtime diagnostics and request capture`, with a test named `TestSanitizeHeadersPreservesActualHeaderValuesForLocalDebugging` asserting that `Authorization` is preserved, so that the Activity panel behaves like a real network inspector. Dropping the key entirely makes an authenticated request indistinguishable from an anonymous one in the capture table — **a lie in the diagnostic data, which is the exact failure class this whole redesign exists to remove.** Redacting the value satisfies the security requirement without destroying the observability intent. A plan that removes a token by making the data less honest has traded one defect for another.

Two findings from their verification that were in neither document:

1. **The token is a permanent credential, not a session secret.** `PairDevice` issues it via `randomHexToken(16)` and `FindByAuthToken` accepts it indefinitely: no expiry, no rotation, revocation only by manual `DELETE /api/devices/{id}`. The "browser devtools also show the Authorization header" analogy does not hold — devtools show it transiently in memory, not persisted alongside its own backups. This raises BR-A1's urgency above what §11 assigned it.
2. **The repository already had this policy in its other observability subsystem.** `internal/observability/eventlog/metadata.go` has long redacted against a default-deny list (`authorization`, `token`, `cookie`, `password`, `secret`, `api_key`, `bearer`) using the constant `redactedMarker = "[redacted]"`. So the capture table's passthrough was never a decision not to redact — it was two observability subsystems drifting apart, one of which stayed behind. `team-bridge` picked the same marker independently, so the vocabulary is consistent.

**The S5 mitigation is now stronger than this plan specified.** §5's S5 called for a manual check of one capture row after BR-A1 landed. `team-bridge` instead pinned it with a test, so a future allowlist reintroduction fails CI before it can break the join silently. Treat the test, not the manual check, as S5's control.

**BR-A3 also landed better than specified.** The cursor clamp in `ListChangesAfterID` was written as the general property `newLastID < lastID` rather than as the `== 0` special case §11 described, with a test fixing a stored maximum of 7 against a client cursor of 2249. A zero-only special case would have missed every other regression shape. Their consumer-impact note also records that across four real devices in the retained window **no client ever regressed** — so BR-A3 closes a trap for the next client rather than repairing observed damage.

---

## 5. Cross-repo synchronization points

Five moments require both repos to be aware of each other. Everything else is independent. S5 is a *negative* dependency — an ordering hazard rather than a prerequisite — and it is the one that was missing from the first draft.

| # | Point | Direction | Why it is a real dependency |
|---|---|---|---|
| S1 | **BR-A2 (B4) before MB-0c** | bridge → mobile | Mobile's `202` confirmation logic encodes `applied_operations` semantics. Undocumented semantics is what produced the current drift. |
| S2 | **BR-B0 settled before BR-B1 and MB-3** | bilateral decision | Without it both sides ship a keepalive on the same timer. |
| S3 | **BR-B1 before MB-3, and rollback in reverse** | bridge → mobile | §12's rollback table: once the bridge evicts superseded sockets, an older mobile reconnecting in a loop is evicted repeatedly. **Roll back bridge first, mobile second. Never revert mobile's socket owner while B2 is live.** |
| S4 | **Bridge capture re-run after MB-0b and after MB-1** | mobile → bridge | Not a code change. `team-bridge` re-runs the `request_captures` histogram so mobile trace cycles can be joined to bridge captures by `X-Sync-Cycle-Id`. Custom headers reach the capture table today because `sanitizeHeadersWithConfig` filters nothing at all (§4.1), **not** because they are allowed — which is what makes S5 a hazard. |
| S5 | **BR-A1 must not narrow header capture before or after MB-0b** | bridge ⇄ mobile, **hazard** | If BR-A1 lands as a re-enabled allowlist, `X-Sync-Cycle-Id` and `X-Sync-Generation` stop being captured and S4's join silently returns nothing (§4.1). This is not fixed by ordering — shipping BR-A1 after MB-0b breaks the join just as thoroughly. The mitigation is the denylist shape, and the check is cheap: after BR-A1 ships, one capture row for a request carrying `X-Sync-Cycle-Id` must still show that header. Run it as part of BR-A1's own verification, not at the start of the measurement campaign. |

---

## 6. Capability map for delta specs

`openspec/specs/` already carries two capabilities that this work extends. Extending them is correct; creating parallel capabilities beside them would fragment the same contract.

| Capability | Status | Changes that write a delta |
|---|---|---|
| `local-write-serialization` | **exists** — File-Keyed Write Serializer, Open-Time Connection Policy, Upfront Write-Lock Acquisition, Reachable Closable Connections, Chapter Mutation Under Contention | **MB-0a** adds the settle guarantee: every queued write resolves or rejects, never neither. This is a new requirement on the existing serializer, not a new capability. |
| `write-failure-diagnostics` | **exists** — Write Failure Diagnostics Captured, User-Facing Failure Copy Unchanged | **MB-0c** adds the typed `phase` / `stage` taxonomy and the rule that a `202` always leaves either a commit or a typed failure (R2). |
| `background-sync-delivery` | new | **MB-0a** (bounded cycle, R8), **MB-2b** (outbox flush job, R1), **MB-2c** (budgeted FGS session, R5), **MB-4** (escalation), **MB-5** (retirement). |
| `sync-observability` | new | **MB-0b** (trace event model, three clocks, correlation id, R6), **MB-2a** (`RuntimeStatusView`, R4). |
| `realtime-socket-ownership` | new | **MB-3** (generation token, read-idle timeout, close-code partition). |

---

## 7. Where this plan can be wrong

| If | Then |
|---|---|
| **H16 confirmed at G0.5** — the device sits in RARE/RESTRICTED with background network disabled | R1 is not achievable while locked by any engine. **MB-2b and MB-4 are cancelled, not deferred.** The guarantee is re-scoped honestly — "delivers on unlock", stated in Settings — and the plan shrinks to MB-0a/0b/0c + MB-2a + MB-3. This is the measurement telling us the requirement was wrong, and the plan must be able to reach that outcome. |
| **H04 falsified at MB-1** — the partial wake lock is honoured and the ticker does fire while locked | The 15 s tick was never the broken part. **MB-2b is not built.** MB-2c collapses to "keep the ticker, fix the transaction and the budget". Cheapest outcome available; the plan must not be structured so that it cannot be reached. |
| **H03 falsified at G0.2** — the device runs API < 35 | The 6 h `dataSync` cap does not bind on this device. Re-evaluate MB-2b and MB-2c against a simpler always-on option before building either. Record it as device-scoped: the app still targets SDK 35, so this is never a licence to drop the cap handling. |
| **H06h falsified at G0.4** | MB-0a remains worth shipping — an unbounded `fetch` is a defect regardless — but it stops being the leading fix, and MB-0b moves ahead of it (§3.1). |
| **G0.6 finds a blocker in §8.6 or §11** | MB-3 and the whole BR-B chain are re-scoped before any code is written. |
| **BR-A1 ships as an allowlist** | The join key vanishes and the entire measurement campaign silently produces nothing (§4.1, S5). This one already happened in draft: the plan asserted the correlation was free, and it was free only by accident. The check is one capture row after BR-A1 lands. |
| **R8 is implemented as a timeout only** | The highest-likelihood way this plan fails while looking successful. Acceptance for MB-0a is not "a timeout exists" but "every `cycle_started` reaches a terminal event". The settle guarantee and the host-signal path land in the same change, never as a follow-up. |

---

## 8. Execution protocol per change

Every change in §3 and §4 runs the same chain, in `auto` mode with gatekeeper validation between phases:

```text
proposal -> specs --> tasks -> apply -> verify -> archive
             ^
             |
           design
```

Fixed rules for this plan:

1. **Artifacts land in both stores.** `openspec/changes/<slug>/` and Engram topic keys `sdd/<change>/{proposal,spec,design,tasks,apply-progress,verify-report,archive-report,state}`.
2. **Strict TDD is active.** Tests live under `tests/features/<feature>/__tests__/` mirroring the feature path — never colocated in `src/`, because `jest.config.js` `roots` will not run them there.
3. **The mutation step is not optional.** Every guard introduced by these changes — cycle-deadline expiry, quarantine threshold, generation-token rejection, write-door settle — gets the stage-first mutation cycle of constraint 9. A test that passes with its guard deleted proves nothing, and coverage will not tell you.
4. **`verify` is never delegated.** The orchestrating agent performs it, and the commit is created before any change is reported as verified — commit-time hooks are part of the verification boundary.
5. **New feature folders are scaffolded**, never hand-made: `npm run generate:feature <name>`.
6. **Bridge Boundary holds.** `X-Sync-Cycle-Id` is added inside `src/infrastructure/api/**` by extending `BridgeRequestSpec` / `buildBridgeHeaders`. No feature code calls `fetch` or constructs a URL. The rule is convention-only and unenforced by lint, so it is the author's responsibility on every one of these changes.
7. **Delivery is local merge to `main`.** No push, no PRs.

---

## 9. Immediate next actions

1. **Operator:** G0.1–G0.3 — three readings, four minutes, no build.
2. **Operator:** G0.4 — the a17 `logcat` window. This single reading decides the order of the first two changes and the standing of the leading root-cause candidate.
3. **Agent, in parallel:** G0.6 — the review lens over §8.6 and §11–§14.
4. **`autoreas-bridge` owner:** decide on BR-A1, BR-A2 and BR-A3. `team-bridge` has reviewed all three and escalated them; nothing on the mobile side blocks them, but a peer session does not start work in a repository it does not own. BR-A1 carries the denylist-vs-allowlist policy decision of §4.1 and should not be implemented before that is settled.

Nothing in §3 is scoped as an SDD change until G0.1–G0.4 are in hand.

---

## 10. Revision 2 — execution without a device (2026-09-04)

**The constraint changed after §1–§9 were written.** There is no device and no `adb` for this execution run; `docker` is available for builds. Every reading in Gate 0 except G0.6 required the phone. That does not merely delay the plan — it removes the gate the entire plan was built around, and the honest response is to re-derive scope rather than to proceed as if the gate had passed.

### 10.1 What was recovered without a device

Two of the four blocked readings turned out to be answerable from artifacts already in the repository. This is the plan's own rule paying off: the readings were cheap, so they were tried before anything was built.

| Reading | Verdict | How |
|---|---|---|
| **G0.3 / H05b** — is the ticker module present in the installed build? | **FALSIFIED — it is present.** The July 2026 fix shipped. | `build-1786545901341.apk` in the repo root, built **2026-08-12 09:45**. `ForegroundSyncTicker` appears **16 times in `classes*.dex`**, and the Hermes bundle (`assets/index.android.bundle`, magic `c6 1f bc 03`) carries the strings `ForegroundSyncTicker`, `minimumInterval`, `background_task`, `foreground_service`, `last_trigger_source` and `pending_operations` in its string table. The module entered the tree 2026-07-16 and was last touched 2026-08-07, both before the build. |
| **Baseline for "what already worked"** | **109 suites, 654 tests, all green, 47.9 s.** | `bun run test` on `26f2cb6`, the regression floor for every change below. |

**Why the H05b result matters more than it looks.** It removes the cheapest available explanation. The design's §8.5 branch table said that if H05 turned out to be "the ticker was never in the build", Phase 2 shrinks to a rebuild. It was in the build, it shipped three weeks before the failing observations, and sync still fails while locked. The remaining candidates are all mechanisms rather than oversights: H06h (the suspended job), H04 (the wake lock not buying Doze network access), and H16 (bucket demotion). None of the three is falsifiable without a device.

### 10.2 The re-derived scope

A change is buildable tonight only if its justification survives with `(device)` still empty. Two categories qualify: **defects verified in source**, which are wrong regardless of which hypothesis is true, and **the instrument itself**, which is what makes future device evidence possible at all.

| Change | Buildable now? | Why |
|---|---|---|
| **MB-0a** `background-sync-bounded-awaits` | **Yes** | Both halves are source-verified defects. `BridgeClient` has no timeout or `AbortSignal` on any path; `minimumInterval: 15 * 60` is read as 900 **minutes**. Neither becomes correct under any hypothesis outcome. The design says so explicitly: R8 "is independent of every measurement". |
| **MB-0b** `sync-trace-observability` | **Yes, and its priority rises** | Without a device this is the *only* path to `(device)` evidence that exists. The instrument ships inside the APK, the user runs it, and the trace records what no session can currently observe. It stops being a precondition for measurement and becomes the measurement's only possible carrier. |
| **MB-0c** `durable-reconcile-footprint` | **Yes** | D1, the A10 upsert and the dead `409` branch are all source-verified defects. `team-bridge` has supplied the verified `applied_operations` semantics (`[]` never `null`) that this change encodes. |
| **MB-2a** `sync-policy-and-status` | **Yes** | R4 is a defect claim, not a hypothesis: `isForegroundServiceRunning` stays `true` after the OS stops the service. Deriving status from measured runtime truth is correct whichever way H03/H04/H16 fall. |
| **MB-3** `websocket-single-owner` | **Yes**, after G0.6 | The generation token is a unilateral defect fix; D9 records "None" as its mobile-side contingency. Its bridge counterpart is separate and already in progress. |
| **MB-2b** `outbox-flush-job` | **No — must not be built** | Contingent on H04, H06h and H16. Building a new native Expo module blind, when the branch table says a falsified H04 means *do not build it*, is precisely the failure that produced three dead designs. |
| **MB-2c** `foreground-session-budget` | **No** | Contingent on H03, H05, H09. |
| **MB-4**, **MB-5** | **No** | Contingent on measurements that cannot be taken, and on MB-2. |

### 10.3 The architectural consequence, stated plainly

The buildable set changes the app's **structure** — bounded cycles, policy separated from mechanism, a durable footprint for every accepted reconcile, status derived from runtime truth, single socket ownership, and an append-only trace — but it deliberately **does not swap the delivery engine**. That is not a shortfall against the plan; it is the plan working. The engine choice was always the contingent part.

And there is a cheaper hypothesis that this scope tests for free. The existing `expo-background-task` path has two verified defects: a 900-minute interval and an unbounded await chain that H06h says suspends the job until the host kills it. MB-0a repairs both. If the engine was failing *because of those two defects*, it will start working without any new engine — and MB-0b's trace is what will say so. Building `OutboxFlushJob` before testing that would be spending a native module to solve a problem that may already be fixed.

**This is what replaces the missing gate:** the APK ships with its own instrument, and the next session reads the trace instead of guessing. `(device)` stops being empty because the device fills it in, rather than because a session assumed on its behalf.

### 10.4 What the deliverable therefore is, and is not

- **Is:** an APK on the repaired architecture, a regression suite that holds the 654-test floor and adds core-behaviour coverage for chapter, anime, state and season sync, and a trace that makes the next diagnosis a reading rather than an argument.
- **Is not:** a verdict on H04, H06h or H16, and not a new delivery engine. Any claim that the locked-device failure is *fixed* would be unfalsifiable tonight, and this document does not make it.

---

## 11. Execution record — the autonomous run of 2026-09-04

What actually landed, in commit order, with the regression floor after each.

| Commit | Change | Suite |
|---|---|---|
| `039681b` | **Core behaviour suite** — harness plus four flows over a real database | 654 → 700 |
| `fbe3d3f` | **MB-0a part 1** — `AbortSignal` on every bridge request; `minimumInterval` 15 h → 15 min; `withDeadline` primitive | 700 → 717 |
| `614d793` | **MB-0a part 2** — host completion signal; cycle deadline below the lock lease; the timing total order | 717 → 726 |
| `70b08ae` | **MB-0a part 3** — write-door deadline that never opens the door; two ESLint selectors | 726 → 730 |
| `01a9431` | **A10 fix** — unconditional existence check; the characterization inverted | 730 |

**Baseline was 109 suites / 654 tests. Final: 122 suites / 730 tests, all green**, with `lint`, `fallow`, `typecheck` and `test:mutation:staged` green in every pre-commit gate.

### 11.1 What the mutation discipline caught that review would not have

Three results worth keeping, because two of them corrected *this plan's own documents*.

1. **The `withDeadline` unhandled-rejection claim was wrong.** The design asserted that `Promise.race` leaves the loser's rejection unhandled and that a swallowing `.catch()` was therefore load-bearing. Deleting that `.catch()` changed nothing — `race` subscribes to every input promise, so the loser always has a handler. The `.catch()` stays as insurance against a refactor that stops racing, and its comment now says so instead of claiming a proof it cannot provide. A test that passes with its guard deleted proves nothing; a comment that describes a mechanism it does not have is worse, because it survives review.
2. **The write-door test discriminates the dangerous implementation.** Chaining the queue on the bounded promise rather than the real write — the naive fix — makes exactly one test fail: *KEEPS THE DOOR CLOSED, admitting no second writer*. The `SQLITE_BUSY_SNAPSHOT` class that cost a change in August is now blocked by a test rather than by a comment.
3. **The host-signal deadline is load-bearing.** Removing it makes the never-settles case hang to jest's timeout instead of returning `failed` — which is precisely H06h's shape, reproduced in a unit test.

### 11.2 A design decision that was wrong and how it surfaced

D1 originally said "apply the migration files and you have the production schema". Building the harness disproved it: `prepareDatabaseSchema` is the migrator **plus eight `ensure*` repair steps**, and two of the eight `REQUIRED_SCHEMA_TABLES` — `sync_cycle_lock` and `active_season_cache` — exist in **no migration file at all**. A migrations-only harness yields a database that fails readiness, and nothing would have failed until a behaviour test took the sync-cycle lock and died several layers from the cause.

The correction is recorded in D1, and a test now pins the gap explicitly so it cannot be rediscovered the expensive way.

### 11.3 What was deliberately NOT built, and why that is the plan working

`OutboxFlushJob` (MB-2b) and the budgeted `FgsSession` (MB-2c) are **not** in this APK. Both are contingent on H04, H06h and H16, and none of those can receive a verdict without a device. §8.5's branch table says a falsified H04 means *do not build the flush job at all* — so building it blind would have been the exact failure that produced three dead designs, dressed up as progress.

What shipped instead repairs the existing engine's two verified defects and ships the instrument to judge them. If the engine was failing *because of* the 900-minute interval and the unbounded await chain, it will now work with no new engine — and that is a claim the device can settle rather than a session asserting it.

### 11.4 The honest status of the locked-device failure

**It is not fixed, and nothing here claims it is.** `(device)` is still empty. What changed is that the failure is now legible: every cycle is bounded and reaches a terminal outcome, a `202` cannot silently vanish, a jammed write door reports itself instead of hanging, and remote records created elsewhere stop disappearing. The next diagnosis is a reading rather than an argument.

---

## 12. The poison-batch freeze — a second, independent reason for the quarantine

Found by `team-bridge` on 2026-09-04 while looking for A10's mirror image on their side. They did **not** find A10 there: the reconcile write path calls `GetMobileAnime` before writing, so an unknown `_id` never falls through to a zero-row update reported as success. Their `applied: true` is honest.

What they found instead is a different member of the same family, and it is worse in shape.

**The bridge side.** A not-found error propagates up through `applyPendingOperations`, which breaks the loop and returns it, and `pendingOperationErrorResponse` has no not-found branch — so it falls to the default and answers **500 for the whole request**. Send five pending operations where exactly one names an anime the bridge does not have, and you do not get `applied: false` for that one and `true` for the other four. You get a 500, an `ErrorResponse` carrying no `applied_operations` at all, and **none of the five lands**.

**The mobile side, verified here.** `isPermanentReconcileError` (`reconcile.helpers.ts:185-187`) treats only 400–499 as permanent; everything else resets the batch to `pending` (`:413`). There is no attempt counter and no escape. So a poison batch is retried identically, forever — **the same 43-hour shape the measured symptom has, reached from an entirely different cause.** A record that is not poisonous because of its content, but because it does not exist on the other side.

**Measured: it has never happened.** 520 reconciles in the retained window, all `accepted` with 202, zero `error_code`. Reachable in theory, unobserved in practice, and *not* the cause of what this redesign is chasing. Recording it as a hypothesis with a `(bridge)` verdict of NOT OBSERVED rather than as a live suspect.

**Why it matters anyway — the quarantine now has two independent justifications.** §8.4 justified it by mobile's own all-or-nothing cursor. This justifies it again by the bridge's all-or-nothing batch. A `dead_letter` transition after N identical failures protects against both, and needs no contract change in either repository. That is a meaningfully stronger case than one reason twice as loud: two unrelated failure modes converge on the same local mechanism.

**A contract asymmetry worth naming, for the bridge owner to decide.** `PATCH /api/animes/{id}` on an unknown id answers **404**, because its handler has the not-found guard. The same id inside a reconcile's `pending_operations` answers **500**. One condition, two status codes, and only one of them tells the client what went wrong. If it is ever taken up it becomes a new BR row: either the reconcile degrades to `applied: false` for that operation and applies the rest, or it answers 404 naming the offending `anime_id` instead of a mute 500. `team-bridge` has escalated it and deliberately did not touch it — it sits outside the three items their repo owner authorized.
