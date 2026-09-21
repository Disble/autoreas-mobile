# Mobile ↔ Bridge sync — architecture

**Status:** Proposal (design only — no production code changed by this document). **Four architecture
decisions were taken on 2026-09-20 (§7)**, and the migration plan in §8 is re-sliced for them.
**Superseded in part 2026-09-21:** parts of the design are now implemented and verified on device
(§5.1, §9.1); §3 describes the pre-change build, and this document is no longer design-only for the
verified behaviours.
**Date:** 2026-09-20.
**Owner:** team-mobile.
**Scope:** synchronization between `autoreas-mobile` and `autoreas-bridge`. Nothing else.
**Relates to:** `docs/mobile-bridge-background-sync-redesign.md` (2026-09-03, measured redesign),
`docs/adr/007-measurement-gated-background-sync.md` (ADR 007),
`docs/mobile-background-sync-investigation-log.md` (the running log), ODD feature
`background-sync-native-bound`.

---

## 0. How to read this document

ADR 007 was written under a hard constraint: **it could not be measured on a device** (device access
was withdrawn for the execution run), so its contingent half was left `Proposed` and the gate it was
built around was declared *unobtainable rather than pending*. That gate has since been walked through:
the 2026-09-19 and 2026-09-20 sessions produced `(device)` evidence for the first time, and it
contradicts part of the earlier reasoning.

This document is therefore not a new design from scratch. It is the **device-grounded successor** to
the 2026-09-03 redesign: it keeps what that design got right, records what the device refuted, and
re-founds the execution layer on the defects the device actually showed.

Every claim carries an evidence class, because conflating them is the failure mode this file exists to
avoid.

| Class | Meaning |
|---|---|
| `(device)` | Observed on the Samsung SM-X800 (Android 15, `com.disble.autoreasmobile` 1.3.0, versionCode 8) with `adb`. |
| `(source)` | Read from code in this repository or in `node_modules`. Decisive about what code *says*. |
| `(docs)` | Official Android documentation, fetched. |
| `(design)` | A decision or expectation in a design document; not evidence about the world. |

---

## 1. What the app must do — the usage profile, and the requirement behind it

**Corrected 2026-09-20, the same day it was written.** The profile below is **one user's usage — the
maintainer's — not the requirement.** Other users run the bridge differently: always on, on demand, or
rarely. The requirement therefore cannot be a schedule. It is a **property**:

> **The app must be cheap while the bridge is absent and reliable when it returns, without knowing the
> schedule in advance.**

**The maintainer's profile, as one instance** (used below to sanity-check costs, never as a constant):

| Fact | Value |
|---|---|
| Bridge availability | **~18 hours a day**, off mainly in the madrugada (~6 h). |
| When animes are watched | **At night** — i.e. while the bridge is off. |
| So when do operations to push appear? | **Inside the window where nobody can receive them.** |
| Accepted delivery delay | **The next morning: 7–8 hours at most.** This delay is accepted by design. |
| What the user sees today | Nothing syncs — not in the morning, not in the afternoon. Sync happens only when the app is opened for another reason while the bridge is up. |

**The acceptance case, stated schedule-agnostically:** *after any period of unavailability — six hours
or six days — the pending operations are pushed within the first hour the bridge is reachable again,
without the user opening the app.*

Three consequences follow, and they are load-bearing:

1. **Cost per attempt must be proportional to availability, not to the calendar.** A no-op attempt
   (bridge absent, nothing to do) must cost milliseconds for every user, whatever their schedule. The
   maintainer's profile is a sanity check, not the target: ~72 attempts a day is the dense case, and a
   bridge that is up one hour a day must cost proportionally less, not more.
2. **The app must be *able* to attempt when the bridge returns**: not restricted by the OS, not starved
   of job quota, not parked from the previous attempt. The trigger cadence is the platform's best
   effort, so the design must never assume that a 15-minute window exists.
3. **A resident 24/7 service is not the default**, because it presumes a schedule. It is one delivery
   mechanism among several and belongs behind policy — chosen when a profile needs near-real-time, not
   hardcoded for a window only some users have. With the engine moved native (§7), the reason the
   service was held at all — keeping JS timers alive while backgrounded — no longer exists.

---

## 2. Current architecture, as built `(source)`

**Stores.** Two SQLite files under `files/SQLite/`:

| Store | Owner of writes | Contents |
|---|---|---|
| `autoreas.db` | everything, through one door | `operation_log` (outbox), `sync_runtime_status`, `sync_cycle_lock`, `animes`, `pending_remote_changes`, `bridge_config`, `active_season_cache`, `season_rating_queue` |
| `autoreas-telemetry.db` | the checkpoint instrument only | `sync_cycle_checkpoint`, `sync_diagnostics_outbox` |

**The write door.** `WRITE_QUEUE_BY_DATABASE` (`client.helpers.ts`) is a module-level `Map` keyed by
database **file path** that serializes every write to that file through a promise chain. `withLocalWrite`
acquires `BEGIN IMMEDIATE` up front and runs the caller's task inside it. The caller's *view* is bounded
by `withDeadline` (`LOCAL_WRITE_DEADLINE_MS = 20 s`), but the queue chains on the real write, and
`withDeadline` explicitly cannot cancel it — "a visible deadlock is the correct outcome; two concurrent
transactions is not".

**Lifecycles.** Three, all inside one process, all sharing that one door:

| Lifecycle | Trigger | Notes |
|---|---|---|
| Foreground UI | app open | React tree; owns the WebSocket and the connection store |
| Foreground service ticker | `ForegroundSyncTicker`, 15 s | native `Handler.postDelayed`; calls into JS |
| Background task | `expo-background-task` → WorkManager, `minimumInterval = 15` min | headless cycle, own isolated non-reactive connection |

**One background attempt, end to end** `(source)`: `open → config → attempt_started → cycle_activated
→ reconcile(backlog_read → claim_ops → http → parse_response → apply_write) → result_bookkeeping →
prune → closed`. Three of those steps write through the door: `recordSyncAttemptStarted`,
`recordCycleActive` and the claim that marks the batch `processing`. In `staged` mode the apply step
writes remote changes into `pending_remote_changes` for the foreground drain; the cycle also writes
`animes` itself through the OCC token path — `persistConfirmedAnimeTokens`/`applyAnimeBridgeToken`,
updating only the `bridge_modified_at` column — unconditionally, in both modes. That token column is
sync-internal and disjoint from the domain ones, so the background's only `animes` write is a token
update, never domain data.

**Bounds on the attempt** `(source)`: six, and all of them are `setTimeout`-based `withDeadline`
(20 s, 10 s, 45 s, 90 s, 35 s, 8 s).

**Coordination** `(source)`: `withExclusiveSyncCycle` claims a `sync_cycle_lock` row — a real lease with
`owner` + `expires_at`, reclaimable by a contender — but the claim itself is **routed through the write
door**.

---

## 3. What the device measured (2026-09-19 / 2026-09-20) `(device)`

Read from the artifacts, not from proxies: `dumpsys activity services`, `dumpsys jobscheduler`, both
databases pulled with `adb exec-out run-as … cat` and queried with `sqlite3 -readonly`, and logcat.

**3.1 Survival is no longer in question.** With the app closed, the process was 11 h 17 m old, the
foreground service had been created 11 h 10 m earlier and last started 8 h 43 m earlier, and it still
read `isForeground=true types=0x40000000` with the persistent notification. No `Service.onTimeout`, no
`ForegroundServiceStartNotAllowedException`, no crash or ANR in 8.5 h of logcat. `specialUse` at
targetSdk 35 did what the T8 decision promised; **the six-hour `dataSync` cap is no longer part of this
mechanism**.

**3.2 Nothing closes. 41 consecutive `never_closed` cycles** between 01:18 and 11:20, one every
**15.9 minutes** (the WorkManager path, not the 15 s ticker), `elapsed_ms` clustered at **600–615 s** —
the platform's worker limit — with outliers at 813 s, 860 s, 1 463 s and 9 061 s. `JobServiceContext:
Client timed out while executing (no jobFinished received)` accompanies every stop. The last recorded
**success was 00:31**.

**3.3 The park is a door write inside the reconcile pass.** The out-of-door checkpoint instrument puts
the furthest entered stage at **`claim_ops`, 261 ms into the cycle**, and the stage held there across
three samples 45 s apart (169 s / 204 s / 272 s) while the same cycle ran. Because stages are published
*before* their await, `claim_ops` names the step that hung: the first write through the shared door
inside reconcile. (The 2026-09-04 reading, taken with the same instrument, placed the hang one stage
earlier, at `backlog_read`; and `Appendix E` of the prior redesign placed its own hang in the
*post-HTTP* `withLocalWrite`. The class is identical, the exact write is not yet discriminated — see
§10.)

**3.4 The door keeps working across cycles — so it is not permanently stranded.**
`sync_runtime_status.last_cycle_id` was a **new** cycle id at read time with a **current**
`last_cycle_stage_at` (11:20:31), and `consecutive_unclosed_cycles` climbed from 34 to 41 within the
hour. Each cycle therefore lands its early door writes (the lease claim and `attempt_started`) and then
parks. This **refutes** the earlier claim that one unsettled queue entry strands every write "for the
remainder of the process" `(design)`; the jam is per-cycle, not process-wide.

**3.5 Nothing releases, and the parked cycle leaves no recoverable state.**

| Reading | Value | Meaning |
|---|---|---|
| `sync_cycle_lock` | `owner = headless_cycle`, **expired** | the lease is stale and nobody releases it |
| `is_cycle_active` | **1** | a flag nobody clears |
| `last_cycle_stage` | `attempt_started` | the in-door instrument never advanced past the second write |
| `last_error_name` / `last_failure_message` / `last_error_stage` | **empty** | the failure path never wrote anything |
| `operation_log` | **2 rows stuck in `processing`**, 15 `synced` | an orphan claim, exactly what the code's own workaround comment describes |

**3.6 The platform is now punishing the app for the burned time.**
`AppStandbyController: Tried to restrict recently used app: com.disble.autoreasmobile due to 1540`
appears immediately after each timeout, and `am get-standby-bucket` answers **45 (RESTRICTED)**. The
system keeps its own counters (`enable_execution_safeguards_udc=true`, `es_u_timeout_reg_count=3`,
`es_u_timeout_total_count=10`): what it counts is **time consumed and jobs that never finished**, not
the success/failure value we return.

**3.7 Gate 1 is untouched.** `deviceidle whitelist` has no entry for the package,
`getFgsAllowStart=PROC_STATE_TOP`, `createdFromFg=true`, `startCommandResult=2` (START_NOT_STICKY). The
service survives because the platform has not killed it, not because it could come back.

**3.8 Why no bound ever cut the hang** — this was answered on 2026-09-04 and the answer still holds
`(source)` + `(device)`. React Native pauses JS timers while the Activity is paused.
`expo-task-manager` compensates by registering a HeadlessJsTask that keeps timers alive, but only
`if (isFirstEvent)`, and its event queue drains solely through `notifyTaskFinished`. **A cycle that never
signals leaves its event id queued, so the next cycle no longer registers the keep-alive: the trap is
self-sustaining.** One cause explains the whole symptom set — the hang, the ten silent minutes, and the
fact that a 45-second deadline did not fire on a build that contained it.

---

## 4. Diagnosis — five structural defects

The device evidence above is not a collection of bugs. It is one architecture failing in five ways, and
each has a name.

**4.1 One file-wide mutex, shared by every lifecycle — a single point of failure.**
The door is keyed by *file*, so the UI's writes, the background cycle's writes, the cycle lease, and the
telemetry-adjacent bookkeeping all serialize through one queue. Three lifecycles that should be isolated
(the UI, the periodic attempt, the service ticker) share one fate: the design has no bulkhead between
them.

**4.2 The mutex has no ownership contract.**
No owner, no expiry, no reentrancy guard, no bypass, no fencing. Its only liveness mechanism is a
`setTimeout` *in the caller*, which cannot cancel the work and must not open the door. That is not a
lock, it is a queue with no failure mode: by construction, **one write that never returns closes it for
everything behind it**.

**4.3 The failure path re-enters the resource that failed.**
Releasing a claim (`revertPendingOperationsOnFailure`) and recording the failure
(`recordSyncAttemptFailed`) are themselves door writes. So when the door parks, the cycle **cannot
succeed and cannot fail**: there is no exit, and therefore no diagnostic. The empty error columns in
§3.5 are that property, observed.

**4.4 The one correct liveness primitive sits downstream of the resource it protects.**
`sync_cycle_lock` is a genuine lease with owner and expiry — the right pattern. But claiming it is
routed through the door. **The system's liveness guarantee depends on the resource it is supposed to
make survive.** The lease expired hours ago and nothing reclaimed it, because reclaiming needs the door
and the only thing that could reclaim it is a cycle that is itself parked.

**4.5 Liveness depends on a timer inside the guarded runtime.**
The project already wrote the rule — *a checkpoint must not depend on the runtime it is measuring* — and
applied it to the instrument (a separate file with its own connection: **0 failed writes** while
everything else was parked). It was **not** applied to synchronization, whose liveness rests on JS
timers in the same runtime that jams. §3.8 shows the consequence: all six bounds are structurally
unable to fire.

**What this means for repair strategy.** Adding timeouts, retries or backoff to this shape does not make
it correct; it makes it fail faster. The execution and ownership layer has to be restructured. This is a
statement about form, not about any single line of code.

---

## 5. What is sound and must be preserved

A re-architecture that discards these would be paying twice for work that is already right `(source)`:

| Asset | Why it stays |
|---|---|
| **The outbox** (`operation_log`) as source of truth for pending work | Durable, queryable, already the basis for "what is pending" |
| **Idempotent, absolute patches** + dedupe by `anime_id` | Makes re-sending safe, which is what lets a retry be free |
| **The bridge protocol** and the changelog cursor | Server-side pruning means the cursor may not advance past a change that exists nowhere else |
| **The checkpoint instrument** (separate file, own connection, ENTRY semantics) | It is what produced §3.3; it is infrastructure, not scaffolding |
| **The stage vocabulary** (`SYNC_CYCLE_STAGES`) | The pipeline is *already* modelled as states; the code just does not reflect it |
| **The lease shape** of `sync_cycle_lock` | Correct primitive, wrong location (§4.4) |
| `BridgeClient` as the only transport owner | Boundary discipline already enforced |

### 5.1 What is verified on device (2026-09-21)

Measured on the lab build carrying `671d38b` and `6b10bcd`, tablet SM-X800 on Android 16. One line per
behaviour, with the commit that carries the change and the instrument that measured it. The last three
rows were measured later the same day on the lab build `build-1790006856748` (built 11:07 from a tree
verified clean at `fc39e7a`, installed 11:11, device read-back `versionCode=9`), which carries
`823d412` on top of the earlier commits.

| Verified behaviour | Commit | Instrument |
|---|---|---|
| **Background delivery without opening the app.** The app had been backgrounded since 08:03:20, the bridge came up at 08:06:44, and at 08:17:59 the engine closed a full cycle in 296 ms delivering three real pending operations. Journal: `idle→checked→claimed→sent→applied→closed`, with an earlier abandoned attempt reclaimed first (`sent→abandoned (recovered by later attempt …)`). `operation_log` reached `synced=22` with nothing unsynced; the cursor advanced 2359 → 2362 on both the device and the bridge. | `671d38b` / `6b10bcd` | bridge capture + journal + `operation_log` |
| **Both background triggers work.** The delivery above came from `triggerSource='background_task'` (WorkManager); a second measurement at 09:41:37 delivered a fresh pending operation from `triggerSource='foreground_service'` (the tick of the notification's foreground service), with the bridge capturing the push at 14:41:20 and the cursor advancing 2362 → 2365. | `671d38b` / `6b10bcd` | bridge capture + journal |
| **The empty-outbox pull works.** The bridge captured a `POST /api/sync/reconcile` with `{"last_changelog_id":2362,"pending_operations":[]}` answered 202 — a pull-only attempt. | `2b70829` | bridge capture |
| **The presence gate works.** With the bridge absent, no cycle ran at all across a 2.5-minute window while the foreground service and its tick alarm were verifiably alive (the alarm was scheduled; the service reported `isForeground=true`); the pre-change build would have produced roughly 15 failed attempts in that window. The probe itself was observed answering: `GET /api/status` returned HTTP 200 to the app's okhttp client. | — | service/alarm dump + bridge + okhttp observation |
| **The attempt budget is wall-clock.** The watchdog budget is an absolute deadline on `SystemClock.elapsedRealtime`, and an attempt that cannot be armed is refused with an `abandoned` journal row rather than running unbounded. | `739fa8a` | journal |
| **The ticker wake lock is scoped to the cycle.** Sampled every 20 s for 100 s while idle, `ForegroundSyncTicker:ticking` was never held; the previous design held a `PARTIAL_WAKE_LOCK` for the whole ticking lifetime (which the system tagged `LONG`). | — | wake-lock sampling |
| **The acceptance instrument reports 12/12 PASS** with 0 failed and 0 unknown (11:52). It now runs **twelve** checks (formerly eleven). The two changes: (a) the "Engine invoked" check no longer false-FAILs by construction — it is pid-scoped like the seam check and lets the T6 presence gate explain a designed refusal, while an unreadable gate state or an unreachable bridge with a complete config stays UNKNOWN, never PASS; (b) a new **cycle-closure** check reads the newest `sync_runtime_status` row and enumerates journal cycles whose newest transition is non-terminal — the §9 metric, previously read by hand, is now measured by the instrument. (The file had reached 498 of its 500 allowed lines, so the host-`sqlite3` half moved to `scripts/lib/device-db-checks.mjs`.) | — | acceptance instrument |
| **The seam-degradation warning reaches the production telemetry channel.** The `[nativeSeam] <module> unavailable` warning is now carried on the production telemetry path — ring → drained at cycle start → piggybacked on the reconcile body — in addition to logcat, which stays as the cable channel; the vocabulary was widened by one `source`/`event` pair and three causes mapping 1:1 to the loader's failure paths. | — | telemetry channel + logcat |
| **The cycle-closure counter reads 0 at the start of the 24 h window, with the mechanism proven alive in the same pass.** Window opened 2026-09-21 11:14 (app launched 11:12, backgrounded 11:14); reading due 2026-09-22 ~11:14. At window start: `consecutive_unclosed_cycles=0`, `is_cycle_active=0`, `last_cycle_stage=closed`, `sync_cycle_lock` empty, `operation_log` `synced=24` with nothing unsynced, native journal at its 500-row cap with the newest transition at 09:41. The mechanism was proven live in the same pass (a flat journal is not evidence unless the mechanism is proven live): foreground service `isForeground=true types=0x40000000`, `dumpsys alarm` reporting `expo.modules.foregroundsyncticker.TICK_ALARM` on the `ELAPSED_WAKEUP` clock, and with the bridge brought up a real background cycle closed at 11:42:40 (`runOnce invoked (triggerSource='background_task', cycleId=d12955a3-…)`, journal `idle→checked→sent→applied→closed`) while the counter stayed 0. | `823d412` | device read-back + `dumpsys` + journal |

Not verified on the same date, recorded plainly in §9.1: `consecutive_unclosed_cycles` does not stay 0,
the exact cost of a refused attempt was not measured, the 24 h metrics were not measured, a
watchdog-triggered abandon has not been observed, and the lease-expiry half of the recovery sweep has
not been observed.

---

## 6. Target architecture

### 6.1 Four layers, each with one job

```
   Observer            Mediator               Durable state machine        Chain of Responsibility
   (facts)             (policy)               (legality + recovery)        (execution)
   ─────────────       ─────────────────      ──────────────────────       ────────────────────────
   bridge presence  →  is an attempt due?  →  which transitions are     →  one link per transition,
   pending changed     is the bridge up?      legal, and what does         each bounded, each able
   app foregrounded    backoff elapsed?       each one compensate?         to report its own failure
   network regained     which trigger?        (persisted journal)
```

- **Observer** carries *facts*: bridge presence changed, an operation was enqueued, the app came to the
  foreground, the network came back. It is the in-process reactivity mechanism, and it makes the
  presence line the trigger it was always meant to be.
- **Mediator** owns *policy and arbitration*: it decides whether an attempt is due, which trigger owns
  it, and what to do with a stale state. It **declares and dispatches; it never waits on the work** —
  otherwise it becomes the next single point of failure.
- **Durable state machine** owns *legality and recovery*: which transitions are permitted, and what
  compensates each state if the attempt dies inside it. Its journal is durable and out-of-door.
- **Chain of Responsibility** owns *execution*: one link per transition, each link with its own budget
  and its own failure contract. This is the natural code shape for the pipeline the app already names
  in `SYNC_CYCLE_STAGES`, and it gives the presence gate a home: the **head of the chain**.

**The hard limit of the first two, stated plainly:** Observer and Mediator make the system *clear and
well-triggered*. They do **not** create liveness. A durable state machine makes a dead attempt
*recoverable*, not *alive*. Only ownership (§6.4) and an external supervisor (§6.5) provide liveness.
All four are needed; none substitutes for another.

### 6.2 The attempt state machine

**The machine is engine-agnostic on purpose**: it describes legality, compensation and recovery, so it
survives the move to a native engine unchanged. What moves is the code that executes the transitions.

Only states with a **compensating action** are states. Stages without compensation remain checkpoints
*inside* a state (this is what keeps the machine from exploding into 11 micro-states).

| State | Entered when | Compensation if the attempt dies here |
|---|---|---|
| `idle` | a trigger was accepted | none — nothing was done |
| `checked` | presence OK, config read, lease taken | release the lease |
| `claimed` | the batch is marked `processing` | return the batch to `pending` |
| `sent` | an HTTP request was issued | **ambiguous**: reconcile by cursor + idempotent patches |
| `applied` | remote changes are applied locally | none — advance |
| `pruned` | the operation log was truncated | none |
| `closed` / `failed` / `abandoned` | terminal | `failed` and `abandoned` require compensation *before* becoming terminal |

**Invariants — these are the properties the current design cannot state:**

1. **No attempt is ever in `claimed` without either reaching `closed` or running the release.**
2. **No state is known only to an in-memory promise.** Any state whose `updated_at` is older than the
   lease is reclaimable by any subsequent attempt — by a sweep in the Mediator, not by the dead
   attempt.
3. **`abandoned` is a first-class outcome**, distinguishable from `failed` and from "nothing to do".

Invariant 2 is the one that converts today's unbounded outage into a bounded one: **a cycle killed in
silence becomes a state the next cycle can act on.** Today, 41 consecutive cycles each died leaving
nothing actionable — a stale lease, a stuck flag and two `processing` rows.

### 6.3 The journal

The machine's journal **must not live behind the door under repair**: if the journal shares the
contended resource, the state of the attempt becomes unreadable exactly when it is needed, and the
recovery path inherits the failure it is recovering from.

- Own file, own connection, append-only (the pattern already proven by `autoreas-telemetry.db`: 0 failed
  writes while the main store was parked).
- One row per transition: `cycle_id`, `from`, `to`, `at`, `attempt_seq`, `reason`.
- The runtime view that Settings reads is **derived** from the journal, not written as a boolean flag
  from inside a closure. `is_cycle_active` as a hand-maintained flag is retired.

### 6.4 Ownership: one writer per store, lease with expiry, fence

- **Bulkhead the stores.** Split the sync-critical state away from the UI's domain writes so that a
  parked UI write cannot park the periodic attempt, and vice versa. The sync path's own stores
  (outbox, cycle state, journal) get their own owner and their own connection policy.
- **One owner per store, recorded, with expiry** — the shape `sync_cycle_lock` already has, applied to
  ownership of the store rather than to the attempt, and **claimed without needing a write to the
  store it guards** (native mutex/actor, or a claim in a store that is not the contended one).
- **Fencing**: a claimant that takes over an expired lease is stamped, and the previous owner's writes
  are rejected. Without this, two attempts can both act on one state.
- **The door keeps its serialization but loses its monopoly**: bounded per component, with an explicit
  failure mode (reject fast) instead of an unbounded queue.

### 6.5 Liveness: the bound must be native

The conclusion in the prior redesign's Appendix E is adopted because the device confirmed it: **adding
another JS deadline cannot work by construction.** That design listed two remedies; the 2026-09-20
decision (§7) resolves which one applies, and the native engine makes the answer unambiguous:

1. ~~Restore the `HeadlessJsTask` registration so JS timers actually run in background.~~ **Not on the
   sync path any more.** With the engine native, no JS timer participates in an attempt, so there is
   nothing to keep alive and no timer to restore. The remedy is retired by the decision, not rejected.
2. **A native watchdog that can abandon an attempt and mark it `abandoned`**, instead of hoping a
   rejected promise eventually settles. The OS's own stop of an over-long job remains the outer
   backstop.

The residual risk is narrow and named: a watchdog that cannot write even its abandon record. That is why
the journal (S1) lands before the watchdog (S2) — if an attempt cannot report, the next attempt's sweep
recovers it from durable state rather than from an in-memory promise.

### 6.6 The presence gate and the attempt policy

- **The head of the chain is presence.** No presence → **no state entered and no write issued**. This is
  the cheap no-op attempt of §1: milliseconds, not 600 s.
- **Presence is a persisted fact, not a foreground-only store.** The background must be able to read it;
  today the status line exists only inside the React tree `(source)`, which is why the background
  "asks" by doing the work.

  **Superseded in part by measurement, 2026-09-21:** the implemented gate probes the bridge directly —
  `GET /api/status` was observed answering HTTP 200 to the app's okhttp client (§5.1). The attempt is no
  longer the only probe; the original "the attempt is the probe / no separate health request" claim is
  superseded by the measurement.
- **Backoff is ours, because the platform offers none**: `expo-background-task` exposes only
  `minimumInterval` `(source)`. A persisted `next_attempt_at`, with jitter, plus the existing network
  callback for `network_regained`.
- **The attempt is the probe** (prior design, adopted): no separate health request on the happy path;
  the typed outcome of a cheap attempt feeds the presence input. But with the gate at the head, the
  *first* attempt after a dark window is what converts "unknown" into "reachable".

### 6.7 What is retired

| Retired | Because |
|---|---|
| `is_cycle_active` as a hand-written flag | replaced by the journal's derived state |
| The attempt's plain success/failure binary result | three outcomes: `closed`, `failed`, `abandoned`; plus "not applicable" |
| A JS timer as the *guarantee* of termination | §4.5, §3.8 |
| Background sync as continuous polling | §1: the bridge is absent; the obligation is outbox delivery with bounded latency (ADR 007 decision 2, upheld) |
| Unbounded retry growth | §3.6: the platform charges for time, not for our report |

---

## 7. Decisions taken (2026-09-20)

| Decision | Taken | What it forces |
|---|---|---|
| **Where the loop lives** | **Native Kotlin engine.** | The paused-JS-timer failure class leaves the sync path entirely, and with it `expo-background-task` and the JS-only bounds. The port is bounded, and that is the load-bearing reason it is viable: in `staged` mode the background cycle applies no `bridge_changes` to `animes` — only the foreground drain hook does `(source)`. **Corrected 2026-09-20** (an earlier version of this row said the cycle never writes `animes`; that came from a code comment, not the code): the cycle's unconditional OCC token writes — `persistConfirmedAnimeTokens`/`applyAnimeBridgeToken`, one `bridge_modified_at` update per confirmed/conflicted record — DO touch `animes` from the background path. That write is a single sync-internal column, disjoint from the domain ones, so it is not a lost-update hazard; what the engine must own is performing those token writes under the cycle lease (defer, re-home, or perform), and what the single-owner actor removes is the shared write door's liveness coupling, not this column. So the native engine needs read outbox → claim → HTTP → map the wire response → stage into `pending_remote_changes` → advance cursor → prune → journal, **plus the token writes**. The domain apply logic stays in TS, where the foreground already owns it. **This decision moves an architectural boundary and needs its own ADR amendment**, not only a code change. |
| **Store and write door** | **Full target: the journal in its own file, the sync store separated (bulkhead), and the file-keyed door replaced by a single-writer actor per store with lease + fencing.** | The single point of failure of §4.1 is removed rather than merely bounded, at the cost of breaking the `local-write-serialization` contract. Ownership becomes the mechanism, so the actor must be killable and its lease reclaimable. |
| **Resident service** | **Not the default; schedule-agnostic.** | The service existed to keep JS alive in the background and to tick; a native engine needs neither. Delivery becomes a policy choice per profile: periodic bounded attempts by default, an opt-in always-on path (resident session, or push if the bridge ever pushes) when a user needs near-real-time. |
| **Liveness** (evaluated, not answered) | **Native watchdog only — and explicitly *not* restoring the `HeadlessJsTask` registration — with journal-based recovery as the safety net.** | With the engine native, no JS timer is on the sync path, so the registration remedy of the 2026-09-04 design becomes unnecessary: the guarantee moves to a native watchdog that can abandon an attempt, with the OS's own job stop as the outer backstop. The residual risk is a watchdog that cannot write even its abandon record, which is why **S1 (the journal) must land before S2 (the watchdog)**: if the attempt cannot report, the next attempt's sweep still recovers it. |

The option space that was on the table, kept for the record:

| Decision | Options | What hangs on it |
|---|---|---|
| **Where the loop lives** | (a) JS loop, native supervisor only; (b) native Kotlin loop | (b) removes the paused-timer class entirely and makes the bound trivial, at the cost of rewriting read → claim → HTTP → apply → prune in Kotlin. This was ODD `background-sync-native-bound` T9; **decided 2026-09-20: native**. |
| **Store split** | (a) one file, ownership by contract; (b) sync state in its own file; (c) journal only in its own file | The journal split is mandatory for the FSM to work (§6.3). Splitting the rest is a bigger surgery with a bigger payoff (§4.1). |
| **Supervision** | (a) restore HeadlessJsTask registration; (b) native watchdog; (c) both | (a) restores bounded attempts in JS; (b) guarantees `abandoned` even with JS paused. Recommended (c) while the engine was assumed to stay in JS; **the 2026-09-20 decision keeps only (b)**, because a native engine has no JS timer on the sync path. |
| **Resident service** | (a) none — attempts only, plus a foreground session while the app is open; (b) resident service, `START_STICKY` + boot receiver + battery exemption | §1 says a resident poller is not the default. (b) is what T7 assumed before the usage profile was written down; **decided 2026-09-20: (a), with always-on as an opt-in policy, not a default**. |
| **Whether to keep the write door at all** | (a) keep, with per-component bounds and a reject-fast failure mode; (b) replace with a single-writer actor per store | (a) is incremental and keeps `local-write-serialization`'s contract; (b) is the cleaner target and the larger change. |

---

## 8. Migration in reviewable slices

Ordered by cost of delay, not by apparent size. Each slice leaves the app working and each is
independently reviewable. **Re-sliced 2026-09-20 for the native engine.**

**S1 — Native journal, recoverable attempt state.**
Own file, own connection, append-only; transitions for the states the code already names. No behaviour
change to sync yet. *Acceptance:* while an attempt is parked, the journal shows `claimed` with a live
`updated_at`, and the app can render it.

**S2 — Native watchdog and the `abandoned` outcome.**
A bound that lives outside the guarded runtime, and an abandon record that a parked store write cannot
skip. *Acceptance:* zero `Client timed out while executing` stops in 24 h; the parked attempt ends as
`abandoned` instead of a ten-minute silence.

**S3 — Recovery sweep.**
On any trigger, a stale state is reclaimed: release the lease, return the batch to `pending`, mark
`abandoned`. *Acceptance:* the orphan `processing` rows return to `pending` with no user action, and the
stale lease of §3.5 is released.

**S4 — Single-writer actor per store, with lease and fencing; sync store separated.**
*Acceptance:* a parked UI write cannot delay an attempt, nor the reverse; a reclaimed lease rejects the
previous owner's writes.

**S5 — Presence gate and attempt policy.**
Persisted presence, short-circuit at the head of the chain, our own backoff with jitter (the platform
exposes none). *Acceptance:* with the bridge absent, an attempt costs `< 2 s` and writes nothing, for any
availability profile. **Note 2026-09-21, from measurement:** the "writes nothing / no cycles" half is
verified on device (§5.1); the exact sub-2-second cost was **not** measured — the measurement supersedes
any assumption that the acceptance figure has been demonstrated.

**S6 — The native engine, and the retirement of the JS background scaffolding.**
The Kotlin engine takes over background delivery; `expo-background-task`, the native ticker and the JS
background bounds leave the sync path. *Acceptance:* the §9 metrics hold with the app closed, and the
foreground path is unchanged.

---

## 9. Acceptance metrics

| | Metric | Threshold | Instrument |
|---|---|---|---|
| Primary | Catch-up after a night with the bridge off | pending operations pushed within the first hour the bridge is up, without opening the app | outbox + journal |
| Primary | `consecutive_unclosed_cycles` with the app closed | 0 for ≥ 24 h | journal |
| Primary | Terminal outcome per attempt | never `abandoned` twice in a row for the same cause | journal |
| Guard | JobScheduler `Client timed out …` stops for the app in 24 h | 0 | `dumpsys jobscheduler` |
| Guard | Stand-by bucket of the package | not `45` (RESTRICTED) | `am get-standby-bucket` |
| Guard | Background job time per day | bounded, not 18 h of duty cycle | `dumpsys jobscheduler` |
| Guard | `sync_cycle_lock` | never stale for longer than one lease | database read |

A `SUCCESS` reported by a suppressed job is **not** evidence that sync ran; the primary metrics must be
read from the outbox and the journal.

### 9.1 As measured on device — 2026-09-21

(Build carrying `671d38b` and `6b10bcd`; tablet SM-X800 on Android 16; measurements detailed in §5.1.)
Verdict per metric above. The 24 h readings were **not** taken.

| Metric | Verdict on 2026-09-21 |
|---|---|
| Catch-up after a night with the bridge off | **Holds.** Three pending operations delivered at 08:17:59 (296 ms) by the background task without the app being opened, and a fresh operation at 09:41:37 by the foreground-service tick; `operation_log` `synced=22` with nothing unsynced; cursor 2359 → 2362 → 2365. |
| `consecutive_unclosed_cycles` = 0 | **Does not hold as measured — and the 24 h window that re-measures it is OPEN.** With the bridge unreachable, every failed cycle of the JS path leaves `is_cycle_active=1` and increments the counter (observed 0 → 1 → 2). The increment is in the JS cycle path, not the native engine, whose attempts always end in a terminal state. The fix `823d412` — both terminal `sync_runtime_status` patch builders write `isCycleActive: false` — is installed on the device, and the 24 h window re-measuring the metric is open (opened 2026-09-21 11:14, reading due 2026-09-22 ~11:14). **A window start is not a result:** at window start the counter reads 0 with the mechanism proven alive (§5.1); the verdict belongs to the closing reading, not the baseline. |
| Terminal outcome per attempt | **Partially verified.** The observed journal is `idle→checked→claimed→sent→applied→closed`; the one `abandoned` row observed came from the recovery sweep. A watchdog-triggered abandon has not been observed. |
| JobScheduler `Client timed out …` stops in 24 h | **Not measured** over a day. At measurement time the acceptance instrument reports 0 execution-guard burns. |
| Stand-by bucket | **Holds at measurement time**: `10 EXEMPTED`. The 24 h reading was not taken. |
| Background job time per day | **Not measured.** |
| `sync_cycle_lock` staleness | **Not directly measured.** Closest evidence: the recovery sweep reclaimed the observed abandoned attempt. |

Also recorded plainly, from the same session:

- **The exact cost of a refused attempt was not measured.** The claim under test is "with the bridge
  absent, an attempt costs < 2 s and writes nothing"; the "writes nothing / no cycles" half is verified
  (presence gate, §5.1), the exact sub-2-second cost is not.
- **The lease-expiry half of the recovery sweep was not observed.**
- `consecutive_unclosed_cycles` is the one primary metric that **fails on measurement**, and the defect
  is in the JS cycle path; the native engine's attempts always end in a terminal state.

---

## 10. Open questions

Stated with the test that would settle each. None of these is a blocker for S1–S2. Two rows are marked
**retired** because the 2026-09-20 decisions removed the premise, and two new rows are the questions those
decisions opened.

| Question | Why it matters | Discriminating test |
|---|---|---|
| **Which door write parks** — the claim, the diagnostics flush, or the post-HTTP apply? | It is the last unknown about the *legacy* path. It stops being a blocker once the engine is native (S6), but it still explains what the app does until then | Bisection: an empty cycle (no backlog → no claim), then stages re-added one at a time, with the journal naming the transition |
| **Does the parked write's promise ever settle?** | §3.4 refuted "stranded for the process", so the queue must be released somehow | Instrument the queue's chain per cycle: log when an entry settles, and how |
| ~~Is restoring the `HeadlessJsTask` registration sufficient?~~ **Retired** | The native engine puts no JS timer on the sync path, so there is nothing to keep alive (§6.5) | — |
| ~~Why did the six abort branches never run?~~ **Retired** | Those branches are JS-timer paths; they are replaced, not repaired | — |
| **Does the foreground path share the park?** | Decides how much of §4.1 is theoretical, and it is the first thing to check because it is free | Open the app during a parked attempt and try a user write; check the UI write's latency |
| **How much wire-schema semantics must the Kotlin engine reproduce?** (new) | The engine maps the reconcile response and stages it; the TS schema and mapper are the source of truth today, and two implementations of one contract drift | Diff the ported mapper against `ReconcileResponseSchema`/`mapWireAnimeToLegacyAnime` on the captured bodies the prior design already extracted, before the JS path is retired |
| **Does staging keep the same guarantees in native hands?** (new, sharpened 2026-09-20) | **Staging itself is fine and stays the boundary; the coupling is the OCC token writes.** The staged/foreground-drain split for `bridge_changes` is what makes the port small, and it is unaffected. But the background path already writes `animes` through the token path today (`persistConfirmedAnimeTokens`/`applyAnimeBridgeToken`, one `bridge_modified_at` column update, sourced only from `applied_operations` — never `bridge_changes[].snapshot.modified_at`, which the bridge hardcodes to 0 — with `0` a real token, so presence, not truthiness, decides), and the engine must keep that write correct under its own lease | Assert on device that the engine's only `animes` write is the disjoint `bridge_modified_at` token update under the cycle lease, with `bridge_changes` still staged for the foreground drain |
| **No deterministic device producer exists for "a parked UI write does not delay an attempt"** (T5's first clause; found in read-only reconnaissance 2026-09-21) | S4/T5's acceptance names a device test, but nothing in the app can park a UI write on demand, so the acceptance cannot be run as written. The door serializes per database file, so what must be shown is the mechanism, not a device event | Host-side scenario holding a write transaction open on one connection: a second write to the same file contends, a write to a second file does not, with a negative control. Explicitly a mechanism proof, not a device proof |
| **Does background sync survive a reboot?** (observed 2026-09-21; **resolved by maintainer decision — do not re-open**) | After a tablet reboot on 2026-09-21 the app had not started 4 minutes in: no process, no tick alarm, and zero registered jobs for the package. So a reboot leaves background sync stopped until the user opens the app. **The maintainer's decision is that this is out of scope**, on the grounds that many applications behave this way. It is consistent with the foreground service and its tick alarm both being started from the JS UI. | None — this row is closed by that decision. Re-open only if the maintainer revisits it. |

---

## Appendix A — Evidence index

| Reading | Command / path |
|---|---|
| Out-of-door instrument | `adb exec-out run-as com.disble.autoreasmobile cat files/SQLite/autoreas-telemetry.db` → `sync_cycle_checkpoint` |
| Cycle history | same file → `sync_diagnostics_outbox` (JSON payload per cycle) |
| In-door status, lease, outbox | `… cat files/SQLite/autoreas.db` (+ `-wal`, `-shm`) → `sync_runtime_status`, `sync_cycle_lock`, `operation_log` |
| Service and type | `adb shell dumpsys activity services com.disble.autoreasmobile` |
| Job accounting | `adb shell dumpsys jobscheduler` (search the uid; `es_u_timeout_*`) |
| Restrictions | `adb shell am get-standby-bucket com.disble.autoreasmobile`, `adb shell dumpsys deviceidle whitelist` |
| Auto-kill | `adb logcat -d -v time \| grep -i "autoreas\|ReactNativeJS"` |

## Appendix B — Glossary

- **Attempt** — one execution of the sync pipeline (today: one headless cycle).
- **Bulkhead** — isolating components so one blocked resource cannot sink the others.
- **Chain of Responsibility** — a request passing through a chain of handlers, each able to handle or
  short-circuit.
- **Compensation** — the action that undoes a state ("release the claim") when the attempt dies inside
  it.
- **Fencing** — stamping the new owner of a reclaimed lease so the previous owner's writes are refused.
- **Journal** — the durable, append-only record of state transitions.
- **Lease** — ownership with an expiry, reclaimable by a contender after it lapses.
- **Mediator** — one component owning policy and arbitration between the others.
- **Observer** — facts published to interested parties without the publisher knowing them.
- **Parked / stuck** — an attempt waiting on a resource that never becomes available.
- **Presence** — whether the bridge is reachable, as a persisted fact.
- **Supervisor** — an external authority that can terminate and mark an attempt as `abandoned`.
- **Write door** — the current file-keyed promise chain that serializes writes to `autoreas.db`.
