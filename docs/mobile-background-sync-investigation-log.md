# Mobile background sync — investigation log

Append-only working log for the mobile background-sync investigation. **Read "Where we are now"
first** — it is the authoritative state and is updated in place. The dated log below is history: it
records what was measured and, just as importantly, what was refuted, so nobody walks the same
paths twice.

Two rules for this file:

1. **Verified facts, hypotheses and refuted claims are labelled as such.** Conflating them cost
   this investigation several hours and produced two wrong diagnoses that reached the maintainer.
2. **A claim is only "verified" with its instrument.** If the instrument was not run, or was run
   and skipped everything, the claim stays a hypothesis.
3. **This file is updated as part of the work, not after it.** Any session that measures, changes
   or refutes something adds its dated entry and updates "Where we are now" in the same pass. Its
   Engram mirror carries the same state, so the next session starts from here instead of
   re-deriving it — which is the whole reason this file exists.

---

## How this app is actually used (a requirement source, stated 2026-09-20)

This section exists because every design decision in this file depends on it, and it had never been
written down. Two sessions of design work — the resident service, the loop's home, the bound — were
reasoned out of assumed usage. That was the process defect, and it is the reason this section sits
above "Where we are now".

**Bridge availability.** The bridge is on roughly **18 hours a day**. It is off mainly in the early
morning (la madrugada).

**When animes are actually watched.** At night. So the operations the app has to push are created
inside — or at the edge of — the window where the bridge is off: the watched animes are recorded while
nobody can receive them.

**What the user expects.** Those operations go up **at the next sync opportunity**, which is the
morning, seven to eight hours later at most. That delay is accepted by design, not a defect.

**What actually happens.** Nothing syncs — not in the morning, not in the afternoon. Sync happens only
by luck at night, when the app is opened for another reason while the bridge is up. The accepted delay
is not some hours: it is never.

**Why the app is expected to be cheap while the bridge is off.** The app already carries a bridge
status line (connected / disconnected). Keeping that status is supposed to be the cheap part, and while
the bridge is off the app is supposed to do nothing expensive. The complaint that started this section:
the app keeps falling into service restrictions, which should not happen for a client whose server is
simply absent.

**What this rules out, and what it implies.**

- A foreground service held 24/7 is not justified by this usage alone: the server is absent for a
  predictable window, and the operations created inside that window cannot be delivered until the
  morning anyway.
- A cycle that discovers "the bridge is not there" only after reading the backlog and claiming the
  batch is paying local work for a question the status line already answers.
- The acceptance case is not "syncs eventually". It is: **after a night with the bridge off, the
  pending operations are pushed within the first hour the bridge is up**, without the user opening the
  app.
- The periodic attempt has to be cheap enough to run all day and still leave the app unrestricted:
  ~18 h of availability at a 15-minute cadence is on the order of 72 attempts a day.

---

## Where we are now

> **2026-09-23 — read this first; the rest of this section predates 1.5.0.** On the installed `1.5.0`
> the alarm and the battery exemption work, but the foreground service did not come back after a
> routine **Android System WebView auto-update** killed the process (06:38:06; the unexplained
> 2026-09-22 02:12:31 death has the same signature). Recovery depends on headless JS, and in the
> revived process the JS thread is frozen: eleven consecutive 600 s job timeouts, zero JS and zero
> engine output, four operations stuck. Recommended direction: a native-owned `START_STICKY`
> service that the tick receiver restarts and that calls the native engine directly. Full entry:
> "2026-09-23 (release 1.5.0 installed)" in the log below.

*Last updated: 2026-09-21 (latest autonomous run) — a **24 h measurement window is open** on the
installed build that carries `823d412` (the cycle-flag fix), the acceptance instrument now runs
**twelve** checks including the cycle-closure check that measures `consecutive_unclosed_cycles`, and T5
was reconnoitred read-only: **the fence it claims does not exist**, and its column has to arrive through
the repair twin. The 24 h reading itself is due 2026-09-22 ~11:14 and is NOT yet taken. See the newest
log entry. The root cause above and the device acceptance of 2026-09-20 23:13 both stand.*

**Implemented and committed, not yet on device (2026-09-21).** T11 (`0db36e5`), the empty-outbox
pull (`2b70829`) and the watchdog budget clock (`739fa8a`) are written, committed on `dev`, and
verified by the grouped Kotlin compile (`BUILD SUCCESSFUL` for `:sync-engine` and
`:foreground-sync-ticker`), 174 suites / 1288 tests, and the pre-commit gate; the acceptance
instrument is `9f2a3fa`. Two findings from that pass are open: (a) `SCHEDULE_EXACT_ALARM` is
denied by default on Android 14+ for apps targeting 33+ (`targetSdkVersion: 35`), and the maintainer decided
on 2026-09-21 to avoid that scenario entirely: the ticker requests no exact-alarm permission and
always uses the inexact `setAndAllowWhileIdle`, whose floor is roughly one alarm per minute (longer
in Doze) — an accepted floor that T6 must turn into an honest base interval, measured on device;
(b) the `settled` interlock is shared across attempts and `runOnce` has no reentrancy guard, so
overlapping invocations can leave one promise unresolved and one watchdog inert. The compiler also
caught a regression that neither the writer's report nor a diff read saw: the response-apply
extraction dropped `updateOperationStatus`, leaving three unresolved references in
`SyncEngineCycle.kt`.

**Root cause, found and fixed (verified; `4654779`).** The three local Expo modules
(`foreground-sync-ticker`, `sync-journal`, `sync-engine`) declared `"android": {
"modulesClassNames": ["..."] }` in `expo-module.config.json`; the key Expo reads on SDK 55 is
`modules` (verified against `node_modules/expo-camera/expo-module.config.json` and `expo-sqlite`).
Autolinking discovered the modules and their classes were inside the APK's dex, but nothing was
registered at runtime, so `requireOptionalNativeModule` returned **null** for `ForegroundSyncTicker`
— and the same for `SyncJournal` and `SyncEngine` (their own absence signals: no journal file, no
engine invocation line). Every native seam therefore degraded to its no-op path: the ticker never
ticked, the journal never wrote a row, the engine was never invoked. The degradation was silent until
the shared `native-module-loader` (`3165cb9`) printed, once per runtime, `[nativeSeam] ...
unavailable ... this seam degrades to a no-op` — the earliest decisive signal of this failure class,
now a check in the acceptance instrument. After `4654779`, `npx expo-modules-autolinking resolve`
reports a classifier for each module, the pre-build check that was missing. **Device acceptance is
no longer pending: on 2026-09-20 23:13 the build carrying `4654779` (registration) and `3e6e10b`
(start ordering, which also keeps the cold-start callback) delivered operation id 19 in background
with the app closed — journal `idle→checked→claimed→sent→applied→closed`, the operation `synced`,
cursor 2352 → 2358; the one acceptance item that failed is the 30 s bound (see the newest log
entry).** Full entry: "2026-09-20 — the root cause: the modules were never registered", in the log
below; the acceptance run and the remaining defect list: "2026-09-21 — the engine works", also
below.

**Symptom.**** With the app closed, mobile does not sync with the bridge. Opening the app syncs
correctly, over the WebSocket (the WS is foreground-only), which is why the defect is invisible
while the app is open. Reproduced on a Samsung Galaxy Tab S8 (SM-X800, Android 15, targetSdk 35),
`com.disble.autoreasmobile` 1.3.0 (versionCode 8).

**Verified mechanism (device-measured; re-measured with the app closed on 2026-09-20).**

1. Every background WorkManager job ends in a JobScheduler stop with `Client timed out while executing
   (no jobFinished received)` — the platform's ~600 s worker limit — and the next one starts
   immediately: **34 `never_closed` cycles between 01:18 and 10:20**, one every **15.9 minutes** (the
   `minimumInterval = 15` WorkManager path, not the 15 s native ticker), `elapsed_ms` clustered at
   600–615 s with outliers at 813 s, 860 s, 1 463 s and **9 061 s**, `error_name` empty in every one.
2. The cycle parks at the first write through the shared door inside the reconcile pass: the
   `withLocalWrite` that marks the claimed batch `processing` (`reconcile.helpers.ts`), published as
   the `claim_ops` checkpoint. The two door writes before it (`recordSyncAttemptStarted`,
   `recordCycleActive`) complete, so the door is not jammed at cycle start.
3. The app's own bounds are **inert** in this failure: `BACKGROUND_SYNC_CYCLE_DEADLINE_MS = 45 s`,
   `BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS = 90 s` and the 20 s `LOCAL_WRITE_DEADLINE_MS` around that
   write all failed to end an attempt the platform ended at 600 s. The earlier thread reading
   constrains any explanation: `mqt_v_js` was **idle in its event loop** (`do_epoll_wait`, 0 % CPU), so
   the parked promise has no live timer behind it — either the deadline is not armed on this path, or
   the runtime pauses timers. Open, and it blocks every other decision.
4. Survival is no longer the open question. With the app closed, process age was 11 h 17 m, the
   service had been created 11 h 10 m earlier and last started 8 h 43 m earlier, and it still read
   `isForeground=true types=0x40000000` with the persistent notification — no `Service.onTimeout`, no
   `ForegroundServiceStartNotAllowedException`, no crash or ANR in 8.5 h of logcat. `specialUse` at
   targetSdk 35 did what T8 promised, and the six-hour `dataSync` cap is no longer part of this
   mechanism.
5. New cost the platform now adds: the repeated timeouts **restrict the app**.
   `AppStandbyController: Tried to restrict recently used app: com.disble.autoreasmobile due to 1540`
   appears twice in the buffer, and `am get-standby-bucket` answers **45 (RESTRICTED)**, which cuts the
   JobScheduler quota. A 600 s burn no longer costs battery alone — it costs the quota the morning
   catch-up needs.
6. Gate 1 is untouched: `deviceidle whitelist` has no entry for the package,
   `getFgsAllowStart=PROC_STATE_TOP`, `createdFromFg=true`, `startCommandResult=2` (START_NOT_STICKY).
   The service survives because the platform has not killed it — not because it could come back.
7. The process is **not** crashing: `dumpsys activity exit-info` shows no `reason=4 (CRASH)` and no
   ANR. One `reason=9 / subreason=7 (EXCESSIVE CPU USAGE)` kill, one `TOO MANY EMPTY PROCS`, one user
   REMOVE TASK, one install-time EXIT_SELF.

**The trigger chain (device-measured 2026-09-20, second session; full entry in the log).** The
mechanism above is not the whole reason nothing syncs — today's second session found three more
links, each measured on the tablet (Samsung SM-X800, Android 15), not inferred:

- **The sync ticker never started.** The explanation first recorded here — that the callback passed
  to `notifee.registerForegroundService(...)` does not run in this build — was **refuted the same
  day** by the `[fgs] foreground sync work started` marker, which printed after
  `displayNotification({ asForegroundService: true })`: the start sequence ran and the seam itself
  was the no-op (see the root cause above). Instruments: `dumpsys power` — no
  `ForegroundSyncTicker:ticking` wake lock while the service is up, and hours with zero attempts
  (`last_attempt_at` frozen, `sync_cycle_lock` empty, no journal file). Ordering fix `3e6e10b`;
  registration fix `4654779`.
- **The engine was unreachable from the active path.** The device runs
  `execution_mode = android_foreground_service`, and in that mode `use-sync-runtime.ts` unregisters
  the background task, so the engine's wiring in `background-sync.task.ts` was dead code on this
  device. The tick now tries the engine first (`e038901`), and the engine now logs its invocation and
  outcome (`cf71725`: invocation line before anything else, completion line with outcome/stage/elapsed,
  plus a once-per-runtime JS warning when the native module is missing), so "ran and parked" and
  "never invoked" are no longer indistinguishable.
- **`expo-background-task` skips the task in the foreground and parks in the background.** Measured:
  at 17:50:46 the worker ran and logged `runTasks: number of consumers 1` followed by
  `runTasks: App is in the foreground`, executed nothing and rescheduled in 15 minutes. With the app
  in the background and the process alive, at 18:05:46 the same worker logged
  `executing tasks for consumer of type expo-background-task` — and then produced nothing: no
  `Worker result`, no journal row, no runtime-status write six minutes later. The 600 s park class
  reproduced in this path.

Also verified the same day: `npx expo-modules-autolinking search --platform android` lists all three
local modules (`sync-journal`, `foreground-sync-ticker`, `sync-engine`) — the engine is in the binary,
so the open question was invocation, not packaging. And a release APK cannot be inspected: the first
build was made with the `production` profile, which is not debuggable, so `adb shell run-as` fails and
neither the journal nor the app database can be read; the `lab` profile plus the gated
`withAndroidLabDebuggable` plugin (`edb4607`, `3d2eb29`) exists for that reason. Separately,
`com.docker.service` being stopped blocks the local build entirely.

**Where the cycle dies (instrument-verified).** The `sync_cycle_checkpoint` instrument — own file, own
connection, outside the shared write door, `failed_checkpoint_count = 0` — reports **`claim_ops`, 261 ms
into the cycle**. The stage held there across three samples 45 s apart (169 s / 204 s / 272 s) while the
same cycle ran, and the write that follows it is the `withLocalWrite` that marks the claimed batch
`processing`. On 2026-09-19 the same instrument stopped one stage earlier, at `backlog_read`; the stall
moved forward with the refactor and is again at a door write.

**The gate the design does not have.** The app carries a bridge status line (`SyncConnectionStatus`:
`idle | syncing | online | unreachable | sync_error`, the `syncConnectionStore`, and the foreground
`useWebSocket` with exponential backoff) — all of it inside the React tree, so it exists only while the
app is open. The headless cycle reads none of it: it reads the backlog, claims the batch through the
shared door and only then calls the bridge. With the bridge off — exactly when the night's watched
animes are recorded — the app pays local work to answer a question the status line already answers for
free.

**Next steps, in order.** Tracked as ODD feature `mobile-sync-native-engine`
(`odd/tasks/mobile-sync-native-engine.md`), which supersedes `background-sync-native-bound`.
`background-sync-handoff-bound` is superseded, and its patch route was retracted on 2026-09-19: the
module is consumed as a prebuilt Maven publication, so a source patch never reaches the compiler.

1. **Run the device acceptance checklist** — **done 2026-09-20 23:13.** With the root-cause fixes in
   place (`4654779` registration, `3e6e10b` ordering, plus `cf71725`, `e038901`), the run verified
   the engine invoked in background with the app closed, `files/sync-journal.db` with transition
   rows (`idle→checked→claimed→sent→applied→closed`), and a fresh `last_attempt_at` (attempts at
   13–26 ms). The delivered operation is itself the direct evidence that no seam degraded to its
   no-op path. The one failed item is the 30 s bound: 78 s of wall clock were measured
   against it, with no `abandoned` row (the `Handler.postDelayed` clock freezes while the CPU is
   suspended). Details and the remaining defect list: the 2026-09-21 log entry below.
2. **Explain why the app's own bounds are inert** (T5). Unchanged by today's findings — the 600 s
   park class reproduced again at 18:05:46 in the `expo-background-task` path. Until this is answered,
   no architecture reused from here is safe, including a native one.
3. **Give the cycle the reachability gate** the foreground already has, so a closed bridge costs
   nothing instead of a local read, a claim and a door write.
4. **Then decide T9/T7** — where the loop lives, and whether a resident service is warranted at all.
   The usage model above is an input to that decision, not an afterthought.

**Metrics of acceptance for any fix** (the WS is foreground-only, so the app must be closed and the
WS down for these to mean anything):

| | Metric | Threshold |
|---|---|---|
| Primary | `sync_cycle_checkpoint.stage` advances to `closed` with the app closed | reaches `closed` |
| Primary | `consecutive_unclosed_cycles` with the app closed | stays 0 for ≥ 24 h |
| Secondary | `Client timed out ... SystemJobService` for the app | 0 in 24 h |
| Guard | JobScheduler `Client timed out ...` stops for the app in 24 h | 0 |
| Guard | stand-by bucket of the package (`am get-standby-bucket`) | not `45` (RESTRICTED) |
| Guard | catch-up after a night with the bridge off | pending operations pushed within the first hour the bridge is up |

`successful_finish` is **not** valid evidence that sync ran: a job suppressed by the foreground
guard also reports SUCCESS, in 38 ms, having done nothing.

---

## Audit — what is validated, what is not

*Added 2026-09-19. Its job is to keep the reader honest about the section above: "Where we are now"
states a mechanism, and this table says how much of that mechanism actually rests on a measurement.*

### A. Tried and validated

| What | Instrument that validated it |
|---|---|
| The checkpoint instrument works end to end | Table created on the device, row written, `failed_checkpoint_count = 0`, stage read back |
| The checkpoint wiring (T1, T2) | 7 tests, RED observed before implementation; `npx lefthook run pre-commit` green with the files staged |
| Every background job ends in `timeout` at 600.0 s; next starts ~127 ms later | `dumpsys jobscheduler` historical stats + logcat |
| The JS thread is idle in its event loop during the hang | `/proc/<pid>/task/<tid>/wchan`, `top -H` |
| `is_cycle_active = 1` and `last_oldest_pending_age_ms` frozen for hours | `sync_runtime_status` read from the device |
| No crash; the process is killed by the system | `dumpsys activity exit-info` (no `reason=4`) |
| `expo-background-task` awaits `awaitAll()` with no timeout and leaves the deferred uncompleted in the `catch` | Installed source, cross-checked against expo/expo#49422 |
| The installed `expo-task-manager` carries expo PR #43821 | `TaskService.java` / `TaskManager.ts` in the installed tree |
| Control vs treatment: 26 ms SUCCESS vs exactly 600.0 s hang | Controlled experiment with the foreground guard as the only variable |
| The 1.3.0 install timestamp and the last healthy close, 45 s apart | `dumpsys package` + bridge telemetry |
| The bridge MCP defect (`get_request_context` on a miss) | Reproduced twice, both from the MCP client and by reading the Go source |
| The dev build's JS is functionally identical to 1.3.0 in the sync path | `git log d0eb20e..HEAD` shows only the SDD chore |

### B. Tried and the attempt itself failed

| Attempt | How it failed | Resolution |
|---|---|---|
| `cmd jobscheduler run -f` without `-n` | `Could not find job` — the job lives in the `androidx.work.systemjobscheduler` namespace | Added `-n` |
| `adb backup` to preserve the broken state | 0 bytes; the device demands an on-screen confirmation | Never completed |
| `npx gentle-ai review mode status` | E404, no such package; `gentle-pi` exposes no binary | Used `gentle_review inspect` instead |
| First `npx lefthook run pre-commit` | Every hook `skip: no matching staged files` — a green that measured nothing | Staged the files, re-ran |
| Forced job at 16:32 and 16:34 | `Delaying execution ... because it is being executed before schedule` | Only usable after the work's `initialDelay` elapses |
| `input keyevent 26` to background the app | `mWakefulness=Awake`; no effect | Unresolved — relied on the natural lifecycle |
| `am start` + HOME to resync `inForeground` | `ResumedActivity` was still the app afterwards | Unresolved; the flag flipped later by itself |
| `curl` to Metro's bundle URL to confirm the served code | 5885-byte response, search string absent | Never retried; confirmed via the reload log instead |
| `kill -3` / `debuggerd -b` for a native thread dump | **Never executed**, though proposed three times | Used `/proc/.../wchan` instead (kernel wait channel only) |
| H6 timer probe (`setTimeout(() => console.log(...))` via Metro) | **Never executed** | Made moot by the primary-source research |

### C. Tried but NOT validated — the largest and most dangerous set

| Claim or action taken | Why it is not validated | What would validate it |
|---|---|---|
| "The cycle's own 35 s `withDeadline` should have fired and did not" | Nothing measured whether the timer was scheduled, nor whether it fired and failed to settle. Inferred from `is_cycle_active` staying 1 | Log the deadline's settlement, or read the checkpoint after a run whose cycle *does* settle |
| "`last_backlog_read_count` frozen proves the reconcile never ran" | It could equally mean the read ran and a later step failed before the bookkeeping write | A checkpoint in the gap settles it directly |
| "No socket to the bridge during the hang" | Measured once, at 14:51, on a cycle hung at an unknown point — not on a checkpoint-instrumented cycle | Re-run `netstat` during a cycle whose checkpoint reads `backlog_read` |
| "33 jobs × 10 min = 5.5 h, so the 6 h `dataSync` budget is exhausted" | Conflates job time with FGS time, and many of those jobs were the 38 ms foreground-suppressed no-ops | `dumpsys` on the FGS budget, or count only the jobs that actually executed a task |
| "1.3.0 caused the regression" | Timestamps correlate; no bisect, no 1.2.2 run, no causal test | Install 1.2.2 and watch whether `closed` returns |
| "The 7 undelivered outbox payloads are part of the failure" | Measured once; the count also dropped 7 → 6 during the session, so the outbox does drain. No mechanism established | Instrument the flush |
| "`derivePreviousCycleOutcome` lets the stuck flag outrank the stage" | Second-hand from the delegated code map; never read in the source, never tested | Read the function and pin it with a test |
| "A healthy cycle completes in about a second" | From a code comment, never measured — with the app open the task is suppressed, so no healthy background cycle was ever observed | A background cycle that reaches `closed` |
| "The stage after `backlog_read` is reachable only after the diagnostics flush" | Second-hand from the code map; never verified against `performSyncPendingOperations` line by line | Read the function |
| Most of the delegated code map (line numbers, reachable stage vocabulary, `reconcile.helpers.ts` internals, the write-door description) | Used heavily on trust; only one claim was checked (the 3-argument signature, and the gate caught it, not me) | Spot-check each claim used in a decision |
| "The FGS is the execution mode in practice" | `execution_mode = android_foreground_service` was read once and never related to any outcome | Correlate the FGS lifecycle with the cycles |
| The acceptance metrics table | **Defined but never run.** The feature has no acceptance validation | Run the metrics |
| The 1.2.2 changelog claim that the migrator ran only the first statement of each chunk | Read, raised as a suspect, then dropped. Never investigated | Inspect the resulting schema against the expected one |

### D. Never tried

| Not attempted | Why it matters | Cost |
|---|---|---|
| **Checkpoints in the gap between `backlog_read` and `http`** (`flushSyncDiagnosticsOutbox`, `readAnimeBridgeTokens`, `buildReconcileRequestBody`, `getLastChangelogId`, `resolveClientTelemetry`) | This is the only un-instrumented stretch on the path the cycle actually dies on. It is what T3 was supposed to resolve and did not | Low — the wiring exists |
| **Patch `awaitAll()` with a `withTimeout` and observe** | Tests the load-bearing link ("the JS task never acknowledges") directly. If the job then ends in ~10 s instead of 600 s, the whole mechanism is confirmed; if it still hangs at 600 s, the mechanism is wrong | Low, and it is the proposed fix anyway |
| **Confirm expo PR #43821 actually activates in this app's headless boot** | The code being present is not the same as it running. Everything in "Where we are now" depends on whether `isRunningTasks` becomes true | Low — one logcat filter on the task-service log lines |
| **Check RN 0.83.10's `JavaTimerManager` for the guard** | The other half of the timer question was verified only on the Expo side | Low |
| Native thread dumps with user-space stacks (`kill -3`, `debuggerd -b`) | `wchan` gives the kernel wait channel only; no stack was ever seen | Low |
| Bisect: install 1.2.2 | The only way to turn the 1.3.0 correlation into a cause | Medium — needs 1.2.2 and a closed-app window |
| `Service.onTimeout` evidence for the Android 15 `dataSync` cap | Would confirm the FGS stop reason rather than inferring it from the documented rule | Low |
| Extending the existing checkpoint table instead of a hypothesis about the flow | — | — |

### E. What the mechanism actually rests on

Everything in "Where we are now" reduces to two links, and **both are unvalidated**:

1. **The JS task never acknowledges completion** — inferred from "the worker does not return", which is itself inferred from the 600 s timeout. Nobody watched the acknowledgement path. *(Testable with the `withTimeout` patch: one run, 11 minutes.)*
2. **The cycle's own bounds do not fire** — inferred from `is_cycle_active` staying 1, which has at least one alternative explanation (the bound fired, and its recovery writes failed through the jammed door — exactly the failure mode `recordAbandonedCycle`'s own docs anticipate). *(Testable by instrumenting the abandonment path, or by observing a cycle that does settle.)*

Everything else in that section is measured. **The two unvalidated links are also the two cheapest to test**, which is what makes the current order of work wrong: the proposed next step (bound `awaitAll`) tests link 1 *as a side effect of shipping the fix*, and should therefore come before any further instrumentation.

---

## Verified facts

Each has its instrument. Anything without one is in the hypotheses or refuted section.

| Fact | Instrument |
|---|---|
| Every background job ends in `timeout`, never `successful_finish`; 600.0 s each; next starts ~127 ms later | `dumpsys jobscheduler` historical stats + logcat `Client timed out while executing (no jobFinished received)` |
| The JS thread is idle in its event loop during the hang, at 0 % CPU | `/proc/<pid>/task/<tid>/wchan` → `do_epoll_wait`; `top -H` |
| No socket to the bridge exists during the hang | `netstat -ano \| grep 9876` (listeners only) |
| `is_cycle_active` stays 1 and `last_oldest_pending_age_ms` is frozen byte-for-byte across hours | `files/SQLite/autoreas.db` → `sync_runtime_status` |
| `readOperationLogBacklog` does not use the shared write door | `operation-log-retention.helpers.ts:142` calls `rawDb.getAllAsync` directly |
| `operation_log` holds 14 rows, all `synced`; the backlog query returns instantly | `files/SQLite/autoreas.db`, `EXPLAIN QUERY PLAN` |
| The checkpoint instrument works end to end: table created, row written, 0 failed writes, `stage = backlog_read` at 295 ms | `files/SQLite/autoreas-telemetry.db` → `sync_cycle_checkpoint` |
| `expo-background-task` awaits `tasks.awaitAll()` with no timeout; its `catch` leaves the deferred uncompleted | `node_modules/expo-background-task/.../BackgroundTaskScheduler.kt:235,247` |
| The installed `expo-task-manager` carries expo PR #43821 (keeps JS timers alive in background tasks) | `node_modules/expo-task-manager/.../TaskService.java:33,406,651,661,702`; `TaskManager.ts:10` |
| The background task is registered with `minimumInterval: 15` (minutes) — the historical 900-minute bug is absent | `shared_prefs/TaskManagerModule.xml` |
| Installed: expo 55.0.28, expo-task-manager 55.0.18, expo-background-task 55.0.20, RN 0.83.10 | `node_modules/*/package.json` |
| Sync reaches the bridge only in short windows at human hours; 0 captures on 09-01 and 09-17; longest gap 46.2 h | bridge `request_captures`, sessions clustered at >30 min separation |
| Last healthy cycle close was 2026-09-15 23:35:47; the 1.3.0 install is `firstInstallTime = 2026-09-15 23:36:32` | bridge telemetry (`last_stage = closed`) + `dumpsys package` |
| Android 15 caps `dataSync` foreground services at 6 h per 24 h, and bringing the app to the foreground resets the timer; the cap is not lifted by the battery-optimisation exemption | developer.android.com, *Foreground service timeouts* and *Behavior changes: apps targeting Android 15* |
| `inForeground` is written only by `OnActivityEntersForeground` / `OnActivityEntersBackground`, and it can stick `true` across a JS reload, after which the task is suppressed and the job reports SUCCESS in 38 ms | `BackgroundTaskModule.kt:49,53` + logcat |

---

## Refuted — do not re-walk these

| Claim | Why it died |
|---|---|
| "The hang is `readOperationLogBacklog` queueing behind the jammed write door" | Both halves false: the function never takes the door (direct `getAllAsync`), and its query returns instantly on a 14-row, all-`synced` table. `claim_ops` is absent from the checkpoint because the claim is *skipped* when the backlog is empty — correct behaviour, not a symptom. |
| "Every bound in the sync path is an inert JS timer" | Built on a stale code comment. The installed `expo-task-manager` carries the upstream fix that keeps JS timers alive during background tasks. Unproven for this build. |
| "A synchronous native call blocks the JS thread" (H1) | `/proc/<pid>/task/<tid>/wchan` shows `mqt_v_js` in `do_epoll_wait`; a thread blocked in SQLite would be in a futex. |
| "A JS spin loop burns the cycle budget" (H4) | 66 threads, 0 running, 733 % idle, all at 0.0 % CPU. |
| "The JS never starts" (H3) | `BackgroundTaskConsumer: Executing task 'autoreas-background-sync'` plus the `attempt_started` DB write. |
| "The cycle settled and the completion callback was lost" (H2) | The `finally` would have released `is_cycle_active`; it is still 1. |
| "The 900-minute interval bug is active" | `minimumInterval: 15` in `TaskManagerModule.xml`; and the >1 h gaps scatter (1.4 h … 46 h) instead of clustering near 15 h. |
| "09-11 is the regression date" | Instrumentation onset. `last_stage` and `consecutive_unclosed_cycles` were introduced by the 09-09 commits (release 1.2.0), so 09-08…09-10 report no value at all rather than a healthy one. |
| "`cmd jobscheduler run -f` is a deterministic reproduction harness" | Only runs once the work's `initialDelay` has elapsed; before that WorkManager answers `Delaying execution ... because it is being executed before schedule`. It also cannot defeat the foreground guard. |
| "The DB file mtime proves there was no activity" | Writes land in `bridge.db-wal`; the main file's mtime lags until checkpoint. |
| "A green `npx lefthook run pre-commit` validates the change" | The first run reported every hook as `skip: no matching staged files` — a green result that measured nothing. The gate needs the files staged. |
| "318 of 320 telemetry rows report `never_closed`, so no cycle ever closed" | 25 of those rows carry `last_stage = closed` with `consecutive_unclosed_cycles = 0`: they closed fine and `outcome` mislabels them (`derivePreviousCycleOutcome` lets the stuck flag outrank the stage). |
| "The battery-optimisation exemption would fix the falling service" | The FGS death is Android 15's `dataSync` budget, not Doze; the exemption is listed only as an exemption for *starting* an FGS from the background. Exempting the app would let a hung cycle hold a wakelock and burn CPU unchecked. |
| "The `registerForegroundService` callback does not run in this build" (2026-09-20, second session) | The temporary marker `[fgs] foreground sync work started`, placed after `displayNotification({ asForegroundService: true })`, printed on the dev client — the callback ran, and the seam itself was the no-op. Root cause: the native modules declared `modulesClassNames` where SDK 55 reads `modules`, so nothing was registered at runtime (`4654779`) |

---

## Log

Newest first.

### 2026-09-23 (release 1.5.0 installed) — the service died again, the trigger is now known, and the recovery path is behind the hang it was meant to survive

**Context.** Installed build `1.5.0` (`versionCode=12`, `lastUpdateTime=2026-09-22 20:07:04`, not debuggable, not profileable). The maintainer reported four pending operations in the app and no sync attempt toward the bridge, and suspected the background service was down again. Everything below was read on tablet `R52T30686RV` at 09:46 with **read-only** instruments (`dumpsys`, `logcat -d`, `/proc`); the process was not killed, restarted or touched. Raw captures: `logcat -b all -d`, `dumpsys activity services|processes|exit-info`, `alarm`, `deviceidle`, `jobscheduler`, `power`, `notification`, `appops`.

**Verified — what 1.5.0 fixed, and it holds.**

- **T1, the exemption:** `dumpsys deviceidle` lists the package under `Whitelist user apps`, added `2026-09-22 08:07:21 by com.android.settings`. `alarm` lists it under `Exempted bucket packages`; `jobscheduler` reports the job `RUNNABLE WHITELISTED`.
- **T2+T3, the manifest receiver re-arms without the previous tick:** `ELAPSED_WAKEUP ... tag=*walarm*:expo.modules.foregroundsyncticker.TICK_ALARM` is pending (`+57s`), with **620 wakeups** delivered and the last one 2.7 s before the capture. And the decisive line: `06:39:12.892 am_proc_start: [0,15428,10540,com.disble.autoreasmobile,broadcast,{.../expo.modules.foregroundsyncticker.TickAlarmReceiver}]` — the receiver brought the process back after it died. The `sent=0` defect of 2026-09-22 is gone.

**Verified — the trigger that stopped the service, and the one that stopped it on 2026-09-22.** `dumpsys activity exit-info`:

```
06:38:06.654 pid=23602 reason=16 (PACKAGE UPDATED) importance=125
  description=stop com.google.android.webview due to installPackageLI
```

and in `events`: `am_kill: [0,23602,...,200,stop com.google.android.webview due to installPackageLI]` followed by `am_foreground_service_stop: [...app.notifee.core.ForegroundService,...,19706645,...,STOP_SERVICE,...]` — the FGS had been up for 5 h 28 min (since ~01:09, proc state `TOP` recorded, so most likely started from the UI — inference). **Android System WebView auto-updated, and the platform kills every process that has WebView loaded.** The same `exit-info` shows the unexplained 2026-09-22 death with the identical signature: `02:12:31.316 pid=32561 reason=16 (PACKAGE UPDATED) ... stop com.google.android.webview due to installPackageLI`. That closes the "Still unproven" item of `odd/tasks/background-service-multiday-survival.md`: **what stopped the FGS at 02:12:31 was a WebView update**, not Doze, not LMK, not the 6 h cap. At 06:39–06:40 the same process logs `Package [...] reported as REPLACED` for Chrome, Word, Bitwarden, YouTube Music and others — this is the Play Store's nightly auto-update batch. **It is a routine event, roughly daily, and it cannot be prevented by the app.** A design that is not recoverable from it is not a background design.

**Verified — what happened after the process came back (06:39 → 09:46, 3 h 07 min).**

1. **The FGS was never restored.** `dumpsys activity services` shows only `SystemJobService`, `startForegroundCount=0`; oom `adj=250`, proc state `TRNB`, capability `-------T` (no `F`); no posted notification; no `am_foreground_service_start` after 06:38; the `START_FOREGROUND` app-op was last used 3 h 08 min earlier (the dead process).
2. **Every headless `expo-background-task` run parks for the full 600 s.** Since the main buffer begins (07:51), eleven consecutive cycles, all identical: `doWork: Running worker` → `Executing task 'autoreas-background-sync'` → exactly ten minutes of nothing → `onStopJob` / `Worker was cancelled` → immediate restart. `jobscheduler` agrees: `3x timeout` / `4x timeout` per stats window. The job wake lock is released at `600006–600114 ms` every time.
3. **Zero JS output and zero native-engine output in all eleven.** No `ReactNativeJS` line and no `SyncEngine*` / `SyncJournal` line in the entire capture. The engine was never invoked; the `console.warn` in `resolveBackgroundTaskOutcome` never printed. Consistent with the four pending operations never leaving the device.
4. **The JS thread is frozen, not busy.** `/proc/15428/task/15474` (`mqt_v_js`): state `S`, **88 clock ticks (0.88 s) of CPU in the whole 3 h 07 min life of the process**, unchanged across three samples 10 s apart. The same process's main thread accumulated 8 min 14 s of CPU and was still burning ~0.45 s per 10 s (~4.5 %) during sampling, with no log output. What the main thread is doing could not be read: the build is neither debuggable nor profileable, so no stack is available. **Unexplained, recorded as a hypothesis-free observation.**
5. **The per-tick wake lock is taken and never returned.** `ForegroundSyncTicker:ticking` is acquired by the live module instance (the headless React host did create it — `activeInstance` is set, and `SyncEngineWatch` exists in the thread list), `onTick` is sent to a JS thread that never runs, `notifyCycleComplete()` never comes, and the lock is held until the platform disables it: `[DIS,600025,ForegroundSyncTicker:ticking...(disabled: nocached)]`, then `[REL,600025,...]`, every ten minutes in lock-step with the job. The only thing bounding it is the platform's cached-process wake-lock policy and the module's own native timeout.

**Verified by reading the code — why T4's watchdog cannot run in this state.** `src/features/sync/background-sync.task.ts` calls `void runForegroundServiceWatchdog()` **after** `await resolveBackgroundTaskOutcome(...)`. `resolveBackgroundTaskOutcome` (`background-sync.helpers.ts:129-150`) is described as "cannot hang or throw", but its bound is `withDeadline`, a JS `setTimeout` — and this log and T4's own document both recorded as device-confirmed (2026-09-04, 2026-09-20) that JS timers do not fire in this headless path. So the watchdog is placed behind exactly the hang the same file says it must not be exposed to. **In today's run it is moot anyway**, because the JS thread did not execute the task callback at all (point 3–4): the watchdog, the cycle and the deadline are all JS, and none of them ran. Either way, the only path 1.5.0 has for restoring the FGS after a process death is a JS path in a headless context, and that path has now been measured dead three separate ways (2026-09-04 timers, 2026-09-20 600 s parks, today a frozen JS thread).

**Correction to earlier entries.** The 2026-09-22 analysis treated the overnight death as "trigger unknown, fix by construction". The trigger is now known and routine. The construction fixed half of it (the alarm), not the half that matters (the service), because the service's recovery was routed through headless JS.

**Refuted today — add to "Refuted".**

- "With the battery exemption granted, the watchdog on the headless wake restores the FGS" — the exemption is granted and verified, the headless wake happens eleven times, and no restore is ever attempted.
- "`resolveBackgroundTaskOutcome` cannot hang" — it is bounded only by a JS timer; the task was cancelled by the platform at 600 s eleven times in a row.

**What the right shape is, from the evidence (recommendation, not yet decided or implemented).** Every link that worked today is native: the alarm, the receiver, the process restart, the exemption. Every link that failed is JS in a process with no Activity. The design that follows is the one Syncthing uses on this same tablet (see 2026-09-19): **the service, its trigger and the sync attempt must not need JS at all.**

1. **Own the foreground service in Kotlin** (a `specialUse` service in our module, returning `START_STICKY`), instead of Notifee's `app.notifee.core.ForegroundService`, which this log measured returning `START_NOT_STICKY` (`startCommandResult=2`, 2026-09-20). Notifee stays for ordinary notifications only. This reverses the T2+T3 decision "the receiver does not restore the FGS": that decision was right while Notifee owned the service, and it is the ownership that has to move.
2. **`TickAlarmReceiver` ensures the service is up** on every tick, natively. Starting an FGS from the background is legal here because the app is on the user power allowlist (verified above) — the exemption T1 bought is exactly what makes this call legal, and today nothing uses it.
3. **The service invokes the native engine directly** (`SyncEngine.runOnce`, which already has its own connections, lease and native watchdog) on each tick, gated by the presence probe. No `onTick` to JS, no JS promise in the loop, no JS timer anywhere on the background path.
4. **JS keeps the UI only**: it starts/stops the service through the module, reads status, and projects the journal. The headless `expo-background-task` becomes, at most, a native-only nudge that starts the service — or is retired.

Checks this design must pass before it is claimed (and the instruments exist for all of them): after a WebView update the process restarts and `am_foreground_service_start` appears for our own service class **without the app being opened**; `SyncEngineCycle` lines appear within one interval; no `Client timed out ... SystemJobService` in 24 h; `ForegroundSyncTicker:ticking` never reaches the platform's `nocached` disable.

**Open, and how to close each.**

- **Why the headless JS thread never runs the task.** Needs a `lab` (debuggable) build of the same commit to take a stack of `mqt_v_js` and the main thread in this state. It matters less if the design above removes JS from the path, but it should be answered before relying on *any* headless JS.
- **The main thread's ~4.5 % CPU in a headless process.** Same instrument.
- **Whether a WebView-update kill restarts a `START_STICKY` service.** Plausible (it is a process kill with reason `PACKAGE UPDATED`, not a force-stop of our package, and our alarm survived it), but not measured. Measure it on the first build that owns its service.

### 2026-09-21 (release 1.4.0 published) — the release is out, and it carries no device evidence

**What shipped.** `main` is `79d95d4` (a merge of `dev`) and the tag `v1.4.0` points at it; both were pushed. Run `35670839702` went green end to end in **31 min 07 s**: `Guard` passed, then `Build and publish`. The release is published, not drafted, at <https://github.com/Disble/autoreas-mobile/releases/tag/v1.4.0> with `autoreas-mobile-1.4.0-android.apk` (**138 583 587 bytes**, 132.2 MiB) and `SHA256SUMS-android.txt`. The downloaded asset's checksum verifies: **SHA-256 `64ee21ab5cfb7b492998ae96e1f55941d1f3e9913c7769f10b568928fc08d5bb`** (`sha256sum -c` reports OK). `aapt2 dump badging` reads back `versionName='1.4.0'`, `versionCode='10'`, `targetSdkVersion:'35'`; the artifact contains no `BundleConfig.pb`, so it is an APK and not an AAB nobody could sideload; and it declares no `debuggable` flag, which is the production profile holding its shape.

**Why there is no device evidence.** A local rehearsal build was the plan — `docker compose -f docker-compose.eas.yml run --rm eas-build lab`, the only profile that is debuggable and therefore the only one whose SQLite state can be read back through `run-as` — and it was running when the maintainer announced the laptop had to be disconnected within five minutes. Publishing through CI was prioritised over the rehearsal for a reason that is worth writing down: **CI builds on GitHub's runners and does not depend on this machine**, while a local build dies with the laptop and its event would have been lost entirely. The container was killed at the NDK/SDK 35 stage, roughly 25 % into Gradle, and the working tree it was reading was about to be invalidated by the merge anyway. The tablet disconnected mid-install of the published APK, so it produced no reading either.

**Therefore, stated plainly: nothing in this pipeline proves the app runs.** Every guard here proves the artifact's *shape*, not its *behaviour*. Unverified on this build: startup on an installed device — including the `fence` column's arrival through the repair twin's `ALTER TABLE sync_cycle_lock ADD COLUMN fence TEXT`, which is the exact startup path this project killed on 2026-09-10 with a re-applied `ALTER` (`duplicate column`); the native claim, ownership read-back and release with a fence token (`e78dc69`, shipped for the first time here); background delivery with the app closed on a 1.4.0 build; the ticker's per-cycle wake-lock scoping; and both backlog gaps below.

**What mitigates it, and what does not.** The APK is signed with the EAS-managed keystore and its SHA-256 is published, so a download can be checked; the schema change in this release is the additive, nullable `fence` column, so reinstalling `v1.3.0` over it is safe rather than stranding. What does not mitigate it is any of the green checks above: they were green on `v1.3.0` too, and the failure this release risks is the kind that only appears when the app is launched on a real device.

**First thing to do when the tablet is back.** Install the published APK, launch it, and read: the app process surviving startup; the journal showing a cycle traversing `idle→checked→sent→applied→closed` with no `LeaseLostException`-driven `abandoned` (a claim that closes is also the proof that the `fence` column exists and the fenced statements run); and the twelve-check instrument. Note the artifact is not debuggable, so `run-as` cannot read its SQLite state — `logcat` carries the `SyncEngine` and `SyncEngineJournal` lines, and a lab build of the same commit is the way to read the database.

**Backlog carried out of this release, both measured and both unshipped.** T13: the native attempt writes no status row, so the Settings surface is frozen at 11:12:40 and `consecutive_unclosed_cycles` can only ever read 0. T14: the presence gate covers only the FGS trigger, so a `background_task` run with the PC off can still spend ten seconds. Both are in `odd/tasks/mobile-sync-native-engine.md` with a frozen contract, and their unverified first implementations are preserved as `../autoreas-mobile-wip-t13-t14.patch`.

### 2026-09-21 (release 1.4.0) — the 24 h window closed as VOID, two migration gaps measured, and the release decision

**Why this entry exists.** The maintainer asked whether the next release was ready, then pointed out that the 24 h window does not need 24 real hours. Reading it early was possible; reading it at all was not, and that is the finding. The release decision that follows is recorded here too.

**The window, closed early and VOID on 2026-09-21 14:47.** Opened 11:14 (3 h 33 min elapsed at the read). `sync_runtime_status` was **frozen at `last_attempt_at = last_success_at = 1790007160232` (11:12:40)**, `last_trigger_source='bootstrap'`, `last_failure_message=NULL`, `consecutive_unclosed_cycles=0` — while the native journal recorded **14 cycles** in the same span, 12 `closed` and 2 `failed` (14:27:52 and 14:43:03, both `failed to connect to /192.168.0.134 (port 9876) … after 10000ms`), every one of them terminal. Two real failures are absent from the status row. `grep sync_runtime_status modules/**/*.kt` returns nothing, and both native branches (`background-sync.helpers.ts` and the FGS adapter's `runCycle`) return from `engine.runOnce(...)` before any status write; the adapter's `catch` never fires because the seam guarantees `runOnce` never rejects.

**Two consequences, one cause.** (1) `settings-screen.helpers.ts:57-61` renders that row, so Settings shows 11:12:40 forever and reports no failure at all — a regression against `v1.3.0`, where the JS cycle wrote the same row and no native engine existed. (2) `consecutive_unclosed_cycles` increments only when a previous attempt left `is_cycle_active` set, and the live path never sets it, so **the column can only ever read 0**: §9's primary criterion was unfalsifiable by construction, and the remaining hours of the window would not have changed that. The falsifiable half is the journal. The cause is one class: the migration moved the cycle to Kotlin and left the layers around it behind.

**The same read found the second instance of that class.** The T6 presence gate exists only in the FGS runner's `createAttemptPolicy`; `runBackgroundSyncCycle` calls the engine directly. Measured with the bridge absent: `runOnce invoked (triggerSource='background_task', cycleId=c350bf58-…)` at 14:42:53 entered `checked`/`sent` and paid `10033ms`, while the `TICK_ALARM` at 14:42:41 was correctly refused and produced no cycle. T6's `< 2 s, writes nothing` acceptance holds only for the trigger that has the gate.

**Decision, and the reversal inside it.** Both gaps were first specified for implementation before the release (T13: the native attempt projects itself into `sync_runtime_status`, with `attempt_started` + `is_cycle_active=1` before `engine.runOnce` and exactly one terminal write after it; T14: the presence probe extracted to a shared helper and gating `runBackgroundSyncCycle` too). An implementation was started and **abandoned unverified** when the maintainer redirected: ship 1.4.0 with what works, and put the details, the possible bugs, the untested paths and the what-ifs in this log and in the backlog. That work is preserved as a patch outside the repository (`../autoreas-mobile-wip-t13-t14.patch`, 1033 lines) and its contract is written into the ODD task document, so nothing is lost and the release ships only verified code.

**The release.** `1.4.0`, a minor bump: the behaviour change is visible and the schema change is additive and nullable (`fence TEXT`), with this project's own precedent of 2026-09-09 stating that an additive nullable migration is a minor bump and not a major one. Path A (CI), tag on `main`.

**Honest limits of this entry.** The fence slice (`e78dc69`) was still unverified on a device when release preparation began, and that is the one open risk this release carries: it touches the repair twin's `ALTER`, the same startup path this project killed on 2026-09-10 with a re-applied `ALTER` (`duplicate column`). A lab build of the release commit is therefore installed and read on the tablet before the tag is pushed; its result is recorded in a later entry.

### 2026-09-21 (autonomous run, latest) — the 24 h window is opened on the build that carries the cycle-flag fix, and the instrument grows the check that measures it

**Why this entry exists.** `consecutive_unclosed_cycles = 0` is the one primary acceptance metric of
architecture-doc §9 that **fails on measurement** (§9.1), and the 24 h readings of §9 have never been
taken. The fix for the leak is `823d412` — both terminal status builders now write `isCycleActive:
false`, so a cycle that reports its outcome cannot leave the flag set — and it was committed at 10:42
today, hours after the installed build (03:18). Nothing can be re-measured on a build that does not
carry it, so the window could not start before a build.

**The artifact read, before installing.** `build-1790006856748.apk` (11:07). The lab profile's
`DEBUGGABLE` flag and `versionCode=9` were read back from the device after install
(`dumpsys package … pkgFlags=[ DEBUGGABLE … ]`). For the JS half, the install carries a **Hermes
bytecode** bundle (`assets/index.android.bundle`, magic `c61fbc03`), whose string table cannot show
object-literal structure — so `isCycleActive: false` is **not** directly readable from it, and this
reading is stated as what it is: the new bundle differs from the previously installed one
(sha256 `0f860b70…` vs `a643aeb9…`; 5 310 716 vs 5 310 704 bytes) and the only bundled source
change between those two builds is `823d412` (the other two commits since are a test file and
documentation, neither bundled). The build ran against a tree verified clean at `fc39e7a`.

**The window, and the positive proof that it is not a flat journal.** The app was launched at 11:12 and
backgrounded at 11:14. At window start: `consecutive_unclosed_cycles=0`, `is_cycle_active=0`,
`last_cycle_stage=closed`, `sync_cycle_lock` empty, `operation_log` `synced=24` with nothing unsynced,
and the native journal at its 500-row cap with the newest transition at 09:41 (the previous delivery).
A flat journal proves nothing on its own, so the mechanism was read alive in the same pass: the
foreground service `isForeground=true types=0x40000000`, and `dumpsys alarm` reporting
`expo.modules.foregroundsyncticker.TICK_ALARM` on the `ELAPSED_WAKEUP` clock. The bridge was then
brought up (`wails dev` in `autoreas-bridge`; `GET /api/status` answers `401` without a token from
both localhost and the LAN address — an HTTP answer, which is exactly what the T6 presence gate counts
as present). With the bridge up, a **real background cycle ran at 11:42:39**: `runOnce invoked
(triggerSource='background_task', cycleId=d12955a3-…)`, journal `idle→checked→sent→applied→closed` at
11:42:40, counter still `0`. So the window measures cycles that actually ran, not a counter that reads
zero because nothing happened.

**The instrument grew the check that measures the metric, and lost a false FAIL.** Two defects were
fixed in the same pass:

1. **Check "Engine invoked" was a false FAIL by construction.** It read the whole `logcat -d` buffer
   and failed whenever no `runOnce invoked` line existed — but with the T6 presence gate, a refused
tick enters no cycle at all, so the absence of an invocation is the *designed* outcome. That was the
   single FAIL of the previous acceptance run. It is now pid-scoped like the seam check
   (`pidof -s` + `logcat -d --pid=<pid>`) so a stale line from an earlier process lifetime can no
   longer PASS it, and a demonstrably complete-or-incomplete bridge-config read decides whether the
   gate legitimately refused. An unreadable gate state or an unreachable bridge with a complete
   config stays **UNKNOWN, never PASS** — the honest verdict, not a comfortable one.
2. **New check: cycle closure.** It reads the newest `sync_runtime_status` row
   (`consecutive_unclosed_cycles`, `is_cycle_active`) and enumerates journal cycles whose newest
   transition is non-terminal. This is the §9 metric, now measured by the instrument instead of by
   hand.

The file had 498 of its 500 allowed lines, so the host-`sqlite3` half moved to a new
`scripts/lib/device-db-checks.mjs` and was re-imported (one-way dependency, no cycle). The instrument
now runs **twelve** checks: `12/12 PASS`, 0 failed, 0 unknown at 11:52 — including the new cycle-closure
check reading `consecutive_unclosed_cycles=0`, `is_cycle_active=0` and every journal cycle terminal,
and the ticker check reading 18 wake-lock acquisitions (the per-cycle scoping, visible as repeated
acquire/release rather than one lifetime hold).

**The seam warning now reaches the production channel.** The `[nativeSeam] <module> unavailable`
warning is what found this project's root cause, and it existed only on the cable (`console.warn` → the
instrument's check 5). It now also records a diagnostic event into the existing ring → drained at cycle
start → piggybacked on `POST /api/sync/reconcile` pipeline, with the vocabulary deliberately widened by
one `source`/`event` pair and three causes that map 1:1 to the loader's three failure paths. The log
line stays: telemetry is the production channel, logcat is the cable channel, both once per runtime,
with a comment saying so. Design debt paid: `docs/mobile-diagnostic-telemetry.md` exists so that
"in production there is no cable" stops being true for this signal.

**T5 reconnaissance, read-only, and it changes the order of work.** The last unimplemented task claims
two acceptances: a parked UI write does not delay an attempt, and a reclaimed lease rejects the
previous owner's writes. Reading the code:

- **The second claim is false today.** `sync_cycle_lock` is `(id, owner, expires_at)`
  (`startup.constants.ts:34-38`) with **no fence column anywhere**, and not one native write checks
  ownership: the owner is the constant `"native_engine"` (`SyncEngineDatabases.kt:15`) and the release
  is `DELETE … WHERE id = ? AND owner = ?` (`SyncCycleLease.kt:63-77`), so a stale attempt's `finally`
  deletes the current row. Reclaiming a lease only prevents *new* claims.
- **The column cannot arrive through the table DDL.** `SYNC_CYCLE_LOCK_TABLE_SQL` is applied with
  `CREATE TABLE IF NOT EXISTS` (`client.helpers.ts:283-285`), so a new column there is a silent no-op
  on every installed device; it must come through the `PRAGMA table_info`-driven repair twin that
  `tests/infrastructure/db/migration-repair-parity.test.ts` enforces.
- **There is no Kotlin unit-test harness** (no test source set in `modules/sync-engine/android/`), so
  "a focused test" for the native fence cannot mean a Kotlin test without adding test infrastructure —
  a separate decision, not part of T5.
- **Clause one has no deterministic device producer.** Nothing in the app can park a UI write on
  demand; the honest instrument is a host-side scenario with a negative control, which proves the
  mechanism and not the device.

**Honest limits of this entry.** The 24 h reading is **not taken** — it is due on 2026-09-22 at about
11:14, and until then this window is a start, not a result. The `sync_runtime_status` counter is written
by the JS cycle path while the native engine writes the journal, so the window pairs two channels: the
counter reads 0 and the journal shows the attempts that actually closed. The bridge is up for the
window by decision of the maintainer; whether it stays up for the whole 24 h is their machine's
profile, and if no cycle runs the window must be recorded as VOID for the metric rather than reported
as a zero that measured nothing.

### 2026-09-21 (autonomous run, later) — the background service delivered, and two of my own readings were wrong

The acceptance criterion — the background service syncing with the bridge — is met, and the two
mistakes that obscured it are recorded here because they cost more time than the measurement did.

**Delivered, from the background.** The app had been in the background since 08:03:20 and the bridge
came up at 08:06:44. At 08:17:59 the engine closed a full cycle in 296 ms and delivered the three real
pending operations (ids 20, 21, 22): journal `idle→checked→claimed→sent→applied→closed`, with
`sent→abandoned (recovered by later attempt …)` reclaimed first, `operation_log` at `synced=22` with
nothing unsynced, and the cursor 2359 → 2362 on both sides. The bridge captured a pull-only reconcile
(`pending_operations: []`, 202) and a `GET /api/status` 200. The instrument reported 11/11 PASS, the
stand-by bucket is `10 EXEMPTED`, there are zero execution-guard burns, and the ticker wake lock was
never held across 100 s of idle sampling. The trigger was `background_task`; the foreground-service
tick probed successfully but no foreground-service-triggered cycle has been observed yet.

**Mistake 1: I read stale artifacts and concluded "nothing happened".** For roughly 25 minutes the
reader pulled the device databases with `adb exec-out … > file 2>/dev/null` and no error check, so a
failed pull silently left the previous copy in place. The stale WAL was 424 KB where the real one was
45 KB — the size was the tell. The reader now fails loudly and discards the reading. This is the same
class the error inventory already lists three times; it is now a control rather than a habit.

**Mistake 2: I overstated the missing-trigger finding.** I reported zero registered jobs for the package
as proof that nothing starts the engine after a reboot or a force-stop. That reading was taken while the
app had not completed startup, and it is contradicted by the delivery above, which came from the
WorkManager path. The corrected claim is narrower and is recorded as T12: the trigger exists and works;
what is unknown is whether that job is registered and survives when the app never completes a startup,
and whether it survives a reboot in foreground-service mode. The flag `is_background_task_registered=0`
does not settle it — it read 0 while that very job was running, so it must not be used as evidence of
absence.

### 2026-09-21 (autonomous run) — the device acceptance is blocked by the keyguard, and the blocker exposes a missing trigger

T6 and the per-attempt interlock landed and are committed (`6b10bcd`, `671d38b`), a lab APK built from
that tree was installed on the tablet, and the acceptance window was then lost to the credential
keyguard. This entry records the measurements that survive, the blocker, and the architectural gap the
blocker exposed.

**Measured before the install (device, bridge down, pre-T6 build): the storm.** The device's
`files/sync-journal.db` held **125 failed attempts, one every 10 seconds**, every one of them a
`sent -> failed` on the 10 s connect timeout to `192.168.0.134:9876`, with the journal's per-state
counts at `claimed=125 sent=125 failed=125 checked=125`. Nothing stopped a tick from starting while
the previous attempt was still timing out. That is the defect T6 closes, and it is the baseline the
gate has to beat.

**Blocked: the app cannot complete its JS startup while the device is locked.** With the keyguard
showing, the app reaches `ReactNativeJS: Running "main"` and stops there: no SQLite open
(`files/SQLite/autoreas.db` mtime unchanged at 03:03), no foreground service, and `dumpsys alarm`
reporting zero alarms for the package. Installing and launching the **previous known-good build**
(`build-1789962052700.apk`, which had synced all night) reproduced the identical stall, so the cause
is the lock and not this change. Attempts to dismiss the keyguard — wake, `wm dismiss-keyguard`,
`cmd lock_settings set-disabled true`, a screen off/on cycle, swipes, `input keyevent 82`, and starting
the activity with `FLAG_SHOW_WHEN_LOCKED` — all left the bouncer in focus. The credential is unknown;
it was deliberately neither cleared nor guessed, and `set-disabled false` was restored together with
`screen_off_timeout=120000` and `stay_on_while_plugged_in=15`.

**Consequence: one earlier reading from this run is VOID.** A four-minute observation of a flat journal
with the bridge down looked like the gate working; it was not. The app's sync runtime had never
started, so there were no ticks to gate. The gate's acceptance stays unmeasured.

**Found while investigating the blocker: there is no trigger after a process death or a reboot.** The
runtime status reads `is_background_task_registered=0` and `dumpsys jobscheduler` lists **no registered
job for the package**, because foreground-service mode unregisters the WorkManager worker
(`background-sync.task.ts:57`). Both the foreground service and its tick alarm are started from the JS
UI. So after a reboot or a force-stop the app delivers nothing until the user opens it — narrower than
the Goal, and the reason the 2026-09-20 23:13 acceptance did not generalise: its foreground service was
already running. Recorded as T12; T8 (retiring the JS background scaffolding) is deferred in part
because removing the WorkManager path before that trigger exists would break the Goal.

**Still open:** the three real pending operations (ids 20, 21 and 22, created 00:48-01:45 local) remain
undelivered; the new build is installed and waiting for an unlock; no acceptance metric was measured.

### 2026-09-21 (later) — three fixes written, one regression caught by the compiler, two findings opened

T11 (wake lock scoped to the cycle), the empty-outbox pull, and the watchdog budget clock were
implemented in one pass with parallel writers over disjoint file surfaces and are committed on
`dev` as `2b70829` (the pull), `739fa8a` (the budget clock) and `0db36e5` (T11), with the
instrument as `9f2a3fa`. Everything below is labelled by instrument: none of the three has been
on a device yet, and the maintainer cannot test
until a later build.

**Verified by instrument (not by report).** Grouped Kotlin compile: `BUILD SUCCESSFUL` for
`:sync-engine` and `:foreground-sync-ticker` (`gradlew ... compileReleaseKotlin` in the build
container, run against a copy under `/tmp` so no `prebuild` output lands in the host tree).
`npx tsc --noEmit` exit 0. Full suite **174 suites / 1288 tests** green. `npx lefthook run
pre-commit` green, staged mutation score **88.89 ≥ 80**.

**The compiler caught a regression that the report and a diff read both missed.** The empty-outbox
fix extracted the response-apply step; the extraction was independently verified byte-identical
against the previous `applyResponseWrites` (69 lines, clean diff), but it also **dropped
`updateOperationStatus`** from `SyncEngineCycle.kt`, leaving three unresolved references (lines 92,
343, 421). The writer's summary asserted no regression on the claim/send path and the diff read
agreed; `:sync-engine:compileReleaseKotlin` failed with `Unresolved reference
'updateOperationStatus'`. The method was restored identically from `HEAD` (10 lines, verified) and
the grouped compile then passed. **Lesson for this file: for Kotlin the compile is the artifact. A
"verbatim move, no regression" claim is a hypothesis until the module compiles.**

**Verified (Android clock semantics + code, not device): the 78 s vs 30 s watchdog gap is a clock
bug.** `Handler.postDelayed` is delivered against `SystemClock.uptimeMillis()`, which does **not**
advance while the CPU is suspended, so a 30 s budget was never exceeded in the watchdog's own clock
and it never fired — consistent with the measured 78 s of wall clock and the absent `abandoned` row.
The budget is now an absolute deadline on `SystemClock.elapsedRealtime()` (counts deep sleep),
re-checked when the callback is delivered; an unarmable watchdog refuses the attempt and traces the
refusal as an `abandoned` row instead of running without a budget. Honest limit: user-space code
cannot run while the CPU sleeps, so the guarantee is "fires at the first schedulable moment after
30 s of wall clock", not an exact-timing wake.

**The same clock class drove T11.** The ticker's inter-tick delay moved from `Handler.postDelayed`
to `AlarmManager` `setAndAllowWhileIdle` with `ELAPSED_REALTIME_WAKEUP`, and the wake lock is
now acquired per dispatched tick and released when JS reports the cycle settled through the new
`notifyCycleComplete()` (a rejection settles too), with a 120 s `acquire(timeout)` safety net.

**Platform consequence, decided 2026-09-21.** `targetSdkVersion: 35` on Android 15 means
`SCHEDULE_EXACT_ALARM` is denied by default. Rather than carry a user-revocable special permission
and an unreachable exact branch, the ticker avoids that scenario entirely: it requests no
exact-alarm permission and always schedules the inexact `setAndAllowWhileIdle`, which stays
suspend-proof because `ELAPSED_REALTIME_WAKEUP` counts deep sleep. The cost is stated honestly: the
system may batch or defer the alarm, with a floor around one alarm per minute and longer gaps in
Doze, so the 15 s `FOREGROUND_SYNC_INTERVAL_MS` is not a cadence the platform honours. The
maintainer accepts that floor; T6 owns the interval value and must measure the delivered cadence on
device before setting it.

**New defect found while auditing the interlock (predates this change; not fixed).** `settled` is a
single flag shared across attempts and `runOnce` has no reentrancy guard: if two invocations overlap,
invocation B's `settled.set(false)` lands while A is in flight, A's worker can leave `settled ==
true`, and B's worker then fails its CAS — B's promise never resolves and B's watchdog is inert at
its deadline. The single-thread executor serializes cycle bodies but not the `runAttempt` prologues.
This is the unresolved-promise hazard the watchdog exists to prevent, so it belongs with T6's
in-flight guard.

**Instrument change, no device run yet.** Check 5 no longer reads the whole logcat ring buffer: it
resolves the live pid (`adb shell pidof -s`) and reads `logcat -d --pid=<pid>`, and it **refuses to
PASS** when the pid cannot be resolved. That removes the false positive that made the previous run
report 10 PASS / 1 FAIL (a stale `[nativeSeam]` warning from a pre-`4654779` process lifetime). No
device was attached for this pass, so the fixed instrument has not been run against hardware.

### 2026-09-21 — the engine works: acceptance verified end-to-end, and what the working engine now measures

The build carrying `4654779` (module registration) and `3e6e10b` (start ordering) was accepted on
device. This entry records what was verified, the one acceptance item that failed, and the defect
list the now-working engine made measurable. Everything labelled **Verified** or **Measured** below
was observed on the tablet; nothing here is inferred from code reading alone.

**Verified: end-to-end background delivery, 2026-09-20 23:13.** With the bridge off, the user marked
a chapter (operation id 19, created 23:05:04). When the bridge came up, the **native engine
delivered it in background with the app closed**: the journal traversed
`idle→checked→claimed→sent→applied→closed`, the operation reached **`synced`**, and the cursor
advanced **2352 → 2358**. After the sync, background attempts cost **13–26 ms** each. This closes
the device acceptance of T2 (a parked attempt leaves a readable state — here a delivered one) and
T7 (a closed app closes a cycle), and it confirms the root-cause fix end to end: the same seams that
were silent no-ops before `4654779` carried a full cycle.

**Verified: the one acceptance item that failed.** The attempt was **not** bounded to 30 s. The
watchdog budget is armed with `Handler.postDelayed`, whose clock freezes while the CPU is
suspended: **78 s of wall clock** were measured against the **30 s** budget, and **no `abandoned`
row** was written. The `abandoned` outcome (T3) remains unobserved on device.

**Measured: the defects the working engine now exposes.** With the engine actually running, the
missing policy layers became measurable instead of hypothetical:

- **No backoff and no presence policy.** With the bridge down the runner attempts **6 times per
  minute, each costing 30–65 s**, logged **20 connection failures in 3 minutes**, and the runner
  discards the cycle promise. This is the T6 gap, now measured.
- **No pull when the outbox is empty** (`SyncEngineCycle.kt`, around line 155): the cycle only
  pushes; an empty outbox means nothing is pulled from the bridge.
- **The temporary `[fgs]` diagnostic is still present** at
  `notifee-foreground-service-adapter.helpers.ts:216` (T10, unchanged).

**Measured: the ticker's wake-lock hold (T11, in progress).** The ticker holds its
`PARTIAL_WAKE_LOCK` for the whole ticking lifetime (`ForegroundSyncTickerModule.kt:51-69`), and the
system tags the hold `LONG`. Another worker is implementing the scoped hold right now; the
requirement text in the ODD task is unchanged, and its device verification stays deferred.

**Debt closed — recorded so it is not re-walked as pending:**

- `patches/` no longer exists, and the stale-prebuild/patch guard was removed from
  `docker-compose.eas.yml`, consistent with the standing rule never to modify a dependency's code.
  The 2026-09-19 entry's build-time guard is therefore history, not current state.
- The app left Android's `RESTRICTED` stand-by bucket: `am get-standby-bucket` now reports
  **10 (EXEMPTED)** — the acceptance guard "not `45`" now holds.

**Still open — recorded as open, not upgraded:**

- **T4's device evidence.** `23e22f3` ships the sweep (`SyncEngineRecovery.sweep(cycleId)` from
  `SyncEngineCycle.runCycle`, right after the lease claim), but neither recovery has been observed
  on device: the two orphan `processing` rows returning to `pending`, and the expired
  `sync_cycle_lock` lease being released.
- **T9's long-absence catch-up and the 24 h metrics.** `consecutive_unclosed_cycles = 0` for 24 h
  and zero JobScheduler `Client timed out` stops have not been measured; the catch-up within the
  first hour was verified once (23:13), not over a long absence.
- **Delivery.** Branch `dev` has never been pushed — there is no `refs/remotes/origin/dev`. Nothing
  has shipped; delivery remains the maintainer's decision.

### 2026-09-20 — the root cause: the modules were never registered

Third session of the day. Everything under **Measured** below was measured on the tablet today; the
mechanism that explains the measurements is verified against the installed Expo tooling, and commit
hashes are cited only as the outcome a finding produced, never as a substitute for the reading.

**Measured, in order.** With the foreground service up (`isForeground=true`, the persistent
notification posted, the `ForegroundServiceTypeLoggerModule` line present in the dump):

- No `ForegroundSyncTicker:ticking` wake lock in `dumpsys power` — the only wake-lock class checked.
- `last_attempt_at` frozen at 14:38 while hours passed; `sync_cycle_lock` empty; no journal file; and
  no `SyncEngine` or `SyncJournal` line anywhere in `logcat -d`.
- `NotifeeHeadlessJS: launched taskId: 1` in the buffer: Notifee dispatches the
  `registerForegroundService` callback through a headless JS task.
- **The ordering hypothesis was tested and refuted.** The suspicion was that anything sequenced after
  `await notifee.displayNotification({ asForegroundService: true })` may never run. A temporary
  marker placed after it — `[fgs] foreground sync work started` — DID print on the next reload. So
  the start sequence ran to completion, and the seam itself was the no-op. Fixed in `3e6e10b`, which
  also keeps the cold-start callback.

**The decisive signal was a warning, and until today it did not exist.** The shared loader
(`native-module-loader`, `3165cb9`) prints a once-per-runtime warning when a seam's native module is
missing. On the dev client it printed:

```
[nativeSeam] ForegroundSyncTicker unavailable (the native module is missing); this seam degrades to a no-op
```

The lesson belongs in this log: the degradation was completely **silent**, and silence is
indistinguishable from a healthy module that simply has not fired yet — which is exactly why hours
went into the wrong layers (FGS lifecycle, execution ordering, headless dispatch). That warning is
the earliest decisive signal of this failure class — earlier and cheaper than the wake lock, which
today proved to be a symptom rather than the signal — and the acceptance instrument now greps logcat
for it.

**Root cause (verified against the installed Expo tooling; fixed in `4654779`).** The three local
Expo modules (`foreground-sync-ticker`, `sync-journal`, `sync-engine`) declared their Android modules
as `"android": { "modulesClassNames": ["..."] }` in `expo-module.config.json`, but the key Expo reads
on SDK 55 is `modules` (verified against `node_modules/expo-camera/expo-module.config.json` and
`expo-sqlite`). Consequences, each verified separately:

- Autolinking discovered the modules (`npx expo-modules-autolinking search --platform android` listed
  all three — recorded earlier the same day as "the engine is in the binary").
- The classes were inside the APK's dex.
- **Nothing was registered at runtime**, so `requireOptionalNativeModule` returned `null` for
  `ForegroundSyncTicker` (the `[nativeSeam]` warning above) — and the same for `SyncJournal` and
  `SyncEngine`, established by their own absence signals: the journal never wrote a row and no file
  exists, and the engine never logged an invocation.

Every native seam therefore degraded to its no-op path: the ticker never ticked, the journal never
wrote a row, and the engine was never invoked. After `4654779`, `npx expo-modules-autolinking
resolve` reports a classifier for each module — the pre-build check that would have caught this
before any 28-minute lab build.

**The fast loop that made this findable (environment, not a finding).** A dev-client APK (build
profile `development`) plus Metro on `http://localhost:8081`, launched with

```bash
adb shell am start -a android.intent.action.VIEW -d "autoreas-mobile://expo-development-client/?url=http%3A%2F%2F192.168.0.134%3A8081"
```

gives Fast Refresh for JS: the bundle reloads in seconds, which is how the `[nativeSeam]` warning was
observed at all. Native changes still cost a ~28-minute lab build.

**Environment fact, still open.** The bridge stopped listening on port 9876 (`curl` from the host
returned `000`; nothing on the port in `netstat`), while the tablet is on the same subnet as the host
(192.168.0.138/24 vs 192.168.0.134). The app's requests therefore time out (`BridgeTimeoutError ...
/api/animes exceeded 10000ms`). This blocks the end-to-end catch-up case but NOT the trigger-chain
verification, which needs no bridge.

**Also committed today, for the ledger:** T4, the recovery sweep (`23e22f3`); the shared
native-module loader that removed 33 duplicated lines (`3165cb9`); and the acceptance instrument
(`2cc79a7`).

### 2026-09-20 — the trigger chain

Second session of the day, after the nine-hour window further down. Device: Samsung SM-X800,
Android 15, `com.disble.autoreasmobile`. Everything in this entry was **measured on the tablet
today**; commit hashes are cited only where the finding produced a fix, never as a substitute for the
measurement.

- **Verified: the sync ticker never starts.** `ForegroundSyncTicker` and the foreground runner were
  started ONLY inside the callback passed to `notifee.registerForegroundService(...)`, and that
  callback does not run in this build. Instruments: `dumpsys power` shows no
  `ForegroundSyncTicker:ticking` wake lock while the service is up, and hours pass with zero attempts
  (`last_attempt_at` frozen, `sync_cycle_lock` empty, no journal file). The service itself is started
  by `notifee.displayNotification({ ..., asForegroundService: true })` in the same `register()`
  method. Fixed in `f48f93b`.
- **Verified: `expo-background-task` skips the task when the app is in the foreground.** Measured:
  at 17:50:46 the worker ran and logged `runTasks: number of consumers 1` followed by
  `runTasks: App is in the foreground`, executed nothing and rescheduled in 15 minutes. With the app
  in the background and the process alive, at 18:05:46 the same worker logged
  `executing tasks for consumer of type expo-background-task` — and then produced nothing: no
  `Worker result`, no journal row, no runtime-status write six minutes later. The 600 s park class
  reproduced in this path.
- **Verified: the engine's invocation was unprovable.** A successful engine attempt logged nothing,
  so "ran and parked" and "never invoked" were indistinguishable. Fixed by `cf71725`: an invocation
  line before anything else, a completion line with outcome/stage/elapsed, plus a once-per-runtime JS
  warning when the native module is missing.
- **Verified: the engine was unreachable from the active path.** The device runs
  `execution_mode = android_foreground_service`, and in that mode `use-sync-runtime.ts` unregisters
  the background task, so the engine's wiring in `background-sync.task.ts` was dead code on this
  device. The tick now tries the engine first (`e038901`).
- **Verified: a release APK cannot be inspected.** The first build was made with the `production`
  profile, which is not debuggable, so `adb shell run-as` fails and neither the journal nor the app
  database can be read. The `lab` profile plus the gated `withAndroidLabDebuggable` plugin
  (`edb4607`, `3d2eb29`) exists for that reason. Separately, `com.docker.service` being stopped
  blocks the local build entirely.
- **Verified locally: the engine is in the binary.** `npx expo-modules-autolinking search --platform
  android` lists all three local modules (`sync-journal`, `foreground-sync-ticker`, `sync-engine`),
  so the open question was invocation, not packaging.

### 2026-09-19

- **The first post-patch build shipped an unpatched APK, and nothing failed.** Verified by control, not by
  absence: the built dex contains `EXPO_BACKGROUND_WORKER` (3 matches) and `BackgroundTaskScheduler`
  (24), so the library compiled in, while the patch's own log string `timed out after` matched **0**
  in every `classes*.dex`. The timeline explains it without invoking a stale cache — the patch,
  `package.json`, `bun.lock` and the patched source all landed at 19:06:25 and the APK was written at
  19:22:17, and a build of that size starts ~20 minutes earlier, so the build's `bun install` ran
  against a tree from before the patch existed. A build-time guard was added to
  `docker-compose.eas.yml` so an unpatched tree cannot reach the build step at all. **This is why the
  dex check has a control string: without it, the absence of the new string would have been read as
  "the patch is compiled but the mechanism failed", and the conclusion would have been the opposite
  of the truth.**
- **Bounded the background hand-off (ODD T3).** A durable bun `patchedDependencies` patch on
  `expo-background-task@55.0.20` applies expo/expo#49422's suggested fix: the `catch` now completes
  the `CompletableDeferred` it used to leave pending, and the await is bounded by
  `withTimeout(TASK_COMPLETION_TIMEOUT_MS = 90_000)`. The `TimeoutCancellationException` is caught
  **inside** `runTasks()` deliberately: it is a `CancellationException`, and `BackgroundTaskWork.doWork`
  rethrows those before reaching its success path, so letting it escape would skip the tail
  `scheduleWorker()` call — and that call is what enqueues the next run, because the worker is a
  self-rescheduling one-time work request, not a periodic one. A timeout must therefore log a bounded
  failure and still reschedule, or the chain dies on the first timeout. Acceptance was the container's
  own first command rather than a proxy: `bun install --frozen-lockfile` succeeds, the patch survives a
  clean reinstall of the package, and the JS suite stays green. No `postinstall` or `prepare` was
  added, which `CI=true` in `docker-compose.eas.yml` depends on.
- **New section: "Audit — what is validated, what is not".** 12 claims tried and validated, 10
  attempts that themselves failed, **13 tried but never validated**, 8 never tried, and the
  conclusion that the stated mechanism rests on exactly two unvalidated links: that the JS task
  never acknowledges, and that the cycle's own bounds do not fire. Everything else is measured.
- **Corrected the stale comment** in `sync-cycle-checkpoint.constants.ts`: it asserted that every
  JS timer bound is dead in the background task, quoting the registration that expo PR #43821
  added. The design it justifies survives; the premise did not. Lint, types and the 7 instrument
  tests stay green.
- **T2 blocked by its own instrument.** The logcat check for the `HeadlessJsTaskContext`
  registration cannot serve as evidence: the buffer covers 13:30:21 → 18:47:28 and holds 86 lines
  from this app — including `BackgroundTaskScheduler` (47), `BackgroundTaskWork` (15),
  `BackgroundTaskConsumer` (4) and `ExpoModulesCore`, so Expo's native logging demonstrably works
  here — yet **not one line carries the `TaskService` tag** (`TaskService.java:58`). The control
  line (`internalRegisterTask`, line 475, which logs unconditionally) is absent as well, and the
  task-restore path can reach a consumer without passing through it, so **no line could be shown to
  be one that must appear**. With no control, a missing log line proves nothing.
  **Replaced by measuring the effect instead of the registration**: a checkpoint at the top of
  `recordAbandonedCycle` fires only if the cycle's own 35 s `withDeadline` fired, which decides
  link 2 in one background run, with no rebuild and no logcat. This is the **third** time in one
  session that an absent log line nearly became a conclusion.
- **Primary-source research overturned a load-bearing premise.** Read the React Native Headless JS
  caveats and expo PR #43821 (merged 2026-03-13, `sdk-55`): `JavaTimerManager.kt:291` stops
  processing JS timers while the Activity is paused **unless** `HeadlessJsTaskContext` reports
  active headless tasks, and `expo-task-manager`'s `TaskService` now registers with it. Verified in
  the installed tree: the fix is present. The repo comment claiming otherwise is stale and must be
  corrected.
- **Found our bug already reported upstream.** expo/expo#49422 describes
  `BackgroundTaskScheduler.runTasks` awaiting `awaitAll()` with no timeout and leaving the deferred
  uncompleted in the `catch`. Closed **without a fix** (the bot asked for a minimal repro), with a
  suggested two-part fix. Verified still absent from the installed 55.0.20.
- **Device validation of the checkpoint instrument (T3).** Reproduced a background cycle and read
  `sync_cycle_checkpoint`: `stage = backlog_read`, 295 ms in, `failed_checkpoint_count = 0`. The
  instrument works; the reading then refuted the hypothesis it was built to confirm (see Refuted).
- **Learned a second way a green result measures nothing.** `inForeground` stuck `true` after a JS
  reload made every job finish in 38 ms with `Worker result SUCCESS` while executing no task at
  all. WorkManager reports success for a job that did nothing.
- **Implemented ODD feature `sync-cycle-checkpoint-wiring`** (T1, T2; T3 above). Wired the
  pre-existing but uncalled checkpoint store: the reconcile pass now publishes `backlog_read`,
  `claim_ops`, `http`, `parse_response`, `apply_write`, and the headless cycle publishes `open`,
  `config`, `attempt_started`, `cycle_activated`, `prune`, `closed`. 7 new tests, RED observed
  before implementation. `npx lefthook run pre-commit` green.
- **The gate earned its keep**: it caught a pre-existing test asserting the old three-argument
  `syncPendingOperations` signature, which was not in the delegated surface list.
- **A delegated worker corrected two of my instructions.** `closed` had to be recorded *after*
  pruning (the delegated placement would have left a healthy cycle reporting `prune`), and the
  `catch`-block prune must not be checkpointed (it would overwrite the stage the cycle died in).
- **Controlled experiment.** Control (app in foreground): the worker runs and returns SUCCESS in
  **26 ms** with the task suppressed. Treatment (app backgrounded, job forced): the task executes,
  then hangs for **exactly 600.0 s** until JobScheduler kills it. Thread dump taken while hung.
- **Debug build installed with the data preserved** (`debuggable=true`, same signing key), which
  unlocked `run-as` and the app's local SQLite databases.
- **Found 7 telemetry payloads never delivered** in `sync_diagnostics_outbox`, including one with
  `outcome: completed` — a value the bridge never received.
- **Correlated the defect with the 1.3.0 install**: `firstInstallTime = 2026-09-15 23:36:32`,
  `lastUpdateTime` the same (a clean install), 45 s after the last healthy cycle close. Zero
  healthy closes since.
- **Rendered a screenshot** of the mobile↔bridge connection snapshot with headless Chrome (a real
  page capture driven by the bridge MCP data, not image generation).
- **Validated the bridge MCP sidecar** (7 tools) and found a real defect:
  `get_request_context` on a not-found id returns a protocol error instead of a not-found result,
  because the miss path returns a zero-value record with `operation_refs: null` and the MCP output
  schema requires an array. `resolve_request_context` also returns unbounded candidates.
- **Reviewed three weeks of bridge telemetry**: sync reaches the bridge only in short windows at
  human hours, with 0-capture days and gaps up to 46.2 h. Every window coincides with the app being
  used.
- **Confirmed the WebSocket is the live channel while the app is open**, which is why "opening the
  app syncs" — and why any measurement of background sync taken with the app open measures the
  wrong channel.
- **Found why the native patch never reached the binary.** `expo-background-task` is consumed as a
  prebuilt AAR, so patching its Kotlin is inert by construction. The build log said so all along
  (`[📦] expo-background-task (55.0.20)` is the publication branch of `ExpoAutolinkingPlugin.kt`), the
  shipped AAR carries the same fingerprint as the APK's dex, and the patch pipeline was verified to
  work on a tree the compiler never reads. See "The source is not the binary" above and corrections
  8 and 9.
- **Closed the seam question for bounding the hand-off outside the library** (`background-sync-native-bound`
  T1). Finishing someone else's in-flight task is **not** reachable: `notifyTaskFinished` is keyed by
  an `eventId` held in private statics, `handleJob`/`cancelJob` need a `JobService`, and the library
  runs only `BackgroundTaskConsumer`. Owning the execution **is** reachable with public API:
  `TaskServiceProviderHelper.getTaskServiceImpl`, a consumer of ours receiving its `TaskInterface` in
  `didRegister`, and `TaskInterface.execute(data, error, callback)` delegating to
  `TaskService.executeTask`, which also performs `maybeStartHeadlessTask` — the registration that keeps
  JS timers alive in the background. The bound therefore belongs in a worker we own, wrapped in our own
  timeout.
- **Extracted the working architecture from `syncthing-android` and compared it live on the tablet.**
  Theirs: one resident foreground service (`SyncthingService`) that hosts the sync engine,
  `START_STICKY`, the persistent notification always on ("Always use startForeground … we don't miss run
  condition events"), a `PARTIAL_WAKE_LOCK` while the native engine runs, `RunConditionMonitor` deciding
  in process, started from `BOOT_COMPLETED`/`MY_PACKAGE_REPLACED`, and **battery-optimisation exempt**.
  Live state: `isForeground=true types=0x00000000`, alive **2 d 15 h 09 m**, `stopIfKilled=false`, and
  **zero JobScheduler entries** — it never uses job scheduling at all. Ours: `targetSdk 35` with a
  `dataSync` type (`types=0x00000001`), started only from the foreground (`createdFromFg=true`),
  `stopIfKilled=true`, **not exempt**, plus a parallel WorkManager job path. The decisive difference is a
  policy, not a style: per `developer.android.com` the 6 h cap applies **only to apps targeting
  Android 15+ and only to the `dataSync` and `mediaProcessing` types**, and Syncthing declares no type at
  all. Table, mechanism and option set: `odd/tasks/background-sync-native-bound.md`, "Extracted
  architecture".
- **Found the gate we actually fail: starting the foreground service from the background.** Per
  `developer.android.com` "Restrictions on starting a foreground service from the background", the
  documented exemptions include *"The user turns off battery optimizations for your app"* and the
  `ACTION_BOOT_COMPLETED` / `ACTION_LOCKED_BOOT_COMPLETED` / `ACTION_MY_PACKAGE_REPLACED` broadcasts;
  without one of them the system throws `ForegroundServiceStartNotAllowedException`. Syncthing holds both.
  Our own service record says `getFgsAllowStart=PROC_STATE_TOP` and `createdFromFg=true`, we declare no
  exemption permission and we have no boot receiver: our foreground service can only be born while the app
  is on screen. That explains the usage-window correlation more directly than the six-hour cap does.
- **Declared `specialUse`, installed it, and crashed the app — then fixed it in our own code.** The
  built APK's binary manifest carries `foregroundServiceType=0x40000000` plus the subtype property, and
  the installed package grants `FOREGROUND_SERVICE_SPECIAL_USE`. The first launch died with
  `IllegalArgumentException: foregroundServiceType 0x00000001 is not a subset of foregroundServiceType
  attribute 0x40000000`, thrown from `startForeground` inside Notifee's service: our own JS call site
  (`notifee-foreground-service-adapter.helpers.ts`) was still naming `data_sync` explicitly. Requesting
  `FOREGROUND_SERVICE_TYPE_MANIFEST` instead lets the library resolve the type from the declaration, so
  the manifest plugin is the single source of truth. The app launches clean afterwards. Lesson recorded:
  the type is a two-place contract (declaration and runtime request), and only one of them should name
  it. **Live confirmation:** with the app opened, `dumpsys activity services` reports
  `types=0x40000000` and `isForeground=true` with the persistent `autoreas-sync-foreground`
  notification — the service now runs as `specialUse`, so the six-hour `dataSync` cap no longer applies.
  Remaining, and it is Gate 1: `createdFromFg=true` (starts only from the foreground), `stopIfKilled=true`
  (no restart), no boot receiver, no battery exemption — plus 26 JobScheduler entries showing the second
  mechanism still in place.

### 2026-09-20 — nine hours with the app closed: the free experiment, and the requirement nobody had written down

**The measurement.** No app interaction for nine hours. Read the app's telemetry database off the tablet
(`adb exec-out run-as com.disble.autoreasmobile cat files/SQLite/autoreas-telemetry.db`, then
`sqlite3 -readonly`) instead of reading a proxy.

- **34 consecutive `never_closed` cycles** between 01:18 and 10:20 — one every **15.9 minutes**, which
  is the `minimumInterval = 15` WorkManager path, not the 15 s native ticker. Every one reports
  `last_stage = attempt_started` from the in-door instrument and an empty `error_name`.
- `elapsed_ms` clusters at **600–615 s** (the platform's worker limit), with outliers at 813 s, 860 s,
  1 463 s and **9 061 s**. `JobServiceContext: Client timed out while executing (no jobFinished
  received)` accompanies each stop.
- The **out-of-door instrument** (`sync_cycle_checkpoint`, own file and connection,
  `failed_checkpoint_count = 0`) puts the furthest stage at **`claim_ops`, 261 ms into the cycle**, and
  held it there across three samples 45 s apart (169 s / 204 s / 272 s) while the same cycle ran.
  Published under ENTRY semantics, `claim_ops` names the `withLocalWrite` that marks the claimed batch
  `processing` — the first write through the shared door inside `reconcile.helpers.ts`. The two door
  writes before it (`recordSyncAttemptStarted`, `recordCycleActive`) completed, so the door is not
  jammed at cycle start.
- **The app's own bounds are inert**: `BACKGROUND_SYNC_CYCLE_DEADLINE_MS = 45 s`,
  `BACKGROUND_SYNC_TASK_SIGNAL_DEADLINE_MS = 90 s` and the 20 s `LOCAL_WRITE_DEADLINE_MS` around the
  parked write all failed to end the attempt that the platform ended at 600 s. The earlier thread
  reading adds the constraint on any explanation: `mqt_v_js` was **idle in its event loop**
  (`do_epoll_wait`, 0 % CPU), so the parked promise has no live timer behind it — either the deadline
  is not armed on this path or the runtime pauses timers.
- **Survival is settled.** Process age 11 h 17 m; the foreground service created 11 h 10 m earlier, last
  started 8 h 43 m earlier, still `isForeground=true types=0x40000000` with the persistent
  `autoreas-sync-foreground` notification; no `Service.onTimeout`, no
  `ForegroundServiceStartNotAllowedException`, no crash or ANR in 8.5 h of logcat. `specialUse` @35 did
  what T8 promised.
- **New cost the platform adds.** `AppStandbyController: Tried to restrict recently used app:
  com.disble.autoreasmobile due to 1540` twice, and `am get-standby-bucket` = **45 (RESTRICTED)**.
  Repeated 600 s timeouts now cut the JobScheduler quota, which is the quota the morning catch-up
  needs. Gate 1 is untouched: no battery exemption, `getFgsAllowStart=PROC_STATE_TOP`,
  `createdFromFg=true`, `startCommandResult=2` (START_NOT_STICKY).

**The requirement this session had to be told, after two sessions of designing without it.** The bridge
is on ~18 h a day and off mainly in the madrugada; animes are watched at night, so the operations the
app must push are created precisely while the bridge is down; the expected delivery is the next morning,
7–8 h later at most. It does not happen — not in the morning, not in the afternoon, and at night only
when the app happens to be open while the bridge is up. The stated design intent is that the cheap part
is the **bridge status line**: while the bridge is off, the mobile app should not be spending anything.
Recorded as its own section, "How this app is actually used", above.

**What the code says about that intent, checked the same day.** The status line exists —
`SyncConnectionStatus` (`idle | syncing | online | unreachable | sync_error`), the `syncConnectionStore`,
and the foreground `useWebSocket` with exponential backoff — but **all of it lives in the React tree**.
The headless cycle reads none of it: `headless-sync-cycle.helpers.ts` imports config, the deadlines,
`syncPendingOperations`, pruning, convergence and the checkpoint store — no reachability check, no
consultation of the connection store. So with the bridge off the app reads the backlog, claims the batch
through the shared door and only then calls the bridge: it pays local work to answer a question the
status line already answers for free.

**Correction of the previous framing.** The bridge being off is not what makes the app burn 600 s per
cycle: the park is at a local write that happens **before** any network call, so it happens identically
while the bridge is up. Both defects are real and independent: (a) the cycle parks forever at that
write, which is why nothing syncs even in the morning; (b) there is no cheap reachability gate, which is
why a closed bridge costs local work at all.

---

## Instruments and paths

**Device.** Samsung Galaxy Tab S8 (SM-X800), Android 15, `com.disble.autoreasmobile` 1.3.0,
debuggable build installed over the release build (same signing key, so the data survives).

**Local data on the device** (`adb exec-out run-as com.disble.autoreasmobile cat <path> > local`):

| Path | Holds |
|---|---|
| `files/SQLite/autoreas.db` (+`-wal`) | `sync_runtime_status`, `operation_log`, `bridge_config`, `sync_cycle_lock` |
| `files/SQLite/autoreas-telemetry.db` | `sync_diagnostics_outbox`, `sync_cycle_checkpoint` |
| `no_backup/androidx.work.workdb` (+`-wal`) | WorkManager `WorkSpec`, `SystemIdInfo.system_id` = the JobScheduler job id |
| `shared_prefs/TaskManagerModule.xml` | `expo-task-manager` registration and `minimumInterval` |

**Bridge database.** `C:/Users/User/AppData/Roaming/Autoreas/data/bridge.db` — `request_captures`,
`runtime_events`. Read with `sqlite3 -readonly`, which is what made crossing three weeks of
telemetry affordable.

**Verifying the native patch actually reached the APK.** Grep the dex, never the source: the patch
can be present in `node_modules`, in `package.json` and in `bun.lock` while the binary was compiled
from a tree that predates it. A dex has no newlines, so `grep` skips it as a single enormous line —
pipe it through `tr` first, and always include a control string that exists in both the patched and
the unpatched library:

```bash
APK=build-*.apk
unzip -o -q "$APK" 'classes*.dex' -d /tmp/dex
for d in /tmp/dex/classes*.dex; do
  echo "$d patch=$(tr -c '[:print:]' '\n' < "$d" | grep -ac 'timed out after')" \
       "control=$(tr -c '[:print:]' '\n' < "$d" | grep -ac 'EXPO_BACKGROUND_WORKER')"
done
```

**Diagnostics.**

```bash
# job outcome and the 10-minute kill
adb shell dumpsys jobscheduler | grep -A2 'u0a540'
adb logcat -d | grep -E "Client timed out|FGS \(dataSync\)|excessive cpu"

# why the process died (no CRASH reason on this device)
adb shell dumpsys activity exit-info com.disble.autoreasmobile

# thread state while hung: idle in the event loop vs blocked in a native call
adb shell "run-as com.disble.autoreasmobile sh -c 'for t in /proc/<pid>/task/*; do printf \"%s|\" \$(basename \$t); cat \$t/wchan; done'"

# force a run — ONLY after the work's initialDelay has elapsed, and only with the app backgrounded
adb shell cmd jobscheduler run -f -n androidx.work.systemjobscheduler com.disble.autoreasmobile <jobId>
```

The force command is a convenience, not a deterministic harness: it is refused before the work's
schedule delay elapses, and it cannot defeat the `inForeground` guard.

**The source is not the binary.** Patching Kotlin in `node_modules` cannot change this app's APK,
because the module is never compiled: `expo-background-task@55.0.20` ships a **prebuilt AAR**
(`expo-module.config.json` → `android.publication`, repository `local-maven-repo`) and autolinking
consumes the publication instead of the source project. Three independent proofs, weakest first:

1. **The build log says so.** `- [📦] expo-background-task (55.0.20)` is the `prebuiltProjects`
branch of `ExpoAutolinkingPlugin.kt` (`project.dependencies.add("api", "groupId:artifactId:version")`);
source projects are logged on the other branch, without the emoji. The log also prints the same 📦
line for 18 other expo modules — every one of them is equally un-patchable from source.
2. **The shipped AAR has the same fingerprint as the dex.** `BackgroundTaskScheduler.class` inside
`node_modules/expo-background-task/local-maven-repo/host/exp/exponent/expo.modules.backgroundtask/55.0.20/expo.modules.backgroundtask-55.0.20.aar`
contains `Task successfully finished` and does **not** contain `timed out after` — byte-for-byte the
same verdict as `classes8.dex` in the APK.
3. **The patch pipeline works and is irrelevant.** The real EAS archive (1154 entries, 321 MB)
carries `project/patches/` and `package.json` with `patchedDependencies`; extracted and installed with
`bun install --frozen-lockfile`, the Kotlin source does carry `withTimeout`. The compiler never reads
that file, and EAS compiles in `/tmp/root/eas-build-local-nodejs/<uuid>/build`, not in `/app`.

The supported escape hatch is `package.json` → `expo.autolinking.android.buildFromSource`, a list of
regexes matched against the Gradle project name (`SettingsManager.kt`, `shouldUsePublication`).
A guard that greps the patched source text verifies a **proxy**, not the artifact: it passed green on
every unpatched APK. The artifact-level control is the dex check below, run **after** the build.

**Device acceptance instrument.** `node scripts/verify-sync-on-device.mjs` is the lab's acceptance
instrument for the native sync work — not temporary tooling. With the tablet connected over adb it
runs the twelve acceptance checks in order (device attached, build identity, lab-readable build, service
state, native seam warnings, ticker wake lock, engine invoked, journal written, attempt freshness,
cycle closure, no execution-guard burns, stand-by bucket), prints `PASS`/`FAIL`/`UNKNOWN` per check with
the raw evidence it read, and exits
non-zero when any check fails. It is read-only on the device: `dumpsys`, `logcat -d`,
`am get-standby-bucket` and file reads through `run-as cat`. It replaces the by-hand
`dumpsys`/`logcat`/`sqlite3` sequence above — the commands stay documented because they are what the
instrument automates, not because anyone should still run them by hand. Host `sqlite3` (SDK
platform-tools) is optional: the DB-backed checks degrade to `UNKNOWN`/existence-only without it,
which is itself the verdict to trust, since reading a live database is evidence collection, not
acceptance.

---

## Corrections made during this investigation

Recorded because each one reached the maintainer before it was corrected, and because the pattern is
the point: **a measured number was mistaken for a mechanism.**

1. "The hang is in `readOperationLogBacklog` behind the write door" → refuted above.
2. "All sync-path bounds are inert JS timers" → based on a stale comment; the upstream fix is
   installed.
3. "09-11 is the regression date" → instrumentation onset, not behaviour.
4. "318/320 cycles never closed" → 25 of them closed and are mislabelled by `outcome`.
5. "The DB mtime shows no activity" → writes go to the WAL.
6. "The gate is green" (first run) → it skipped every hook.
7. "The forced job is a deterministic reproduction" → only after the schedule delay elapses.
8. "The APK was unpatched because the build predated the patch" → insufficient, and false as a
   cause: two builds made *after* the patch (`176f4958…`, `cf0220e3…`, both 20:5x) were unpatched as
   well. The patch edits Kotlin source that the Android build never compiles; the module is consumed
   as a prebuilt AAR.
9. "A guard that greps `withTimeout` in the patched `.kt` proves the patch is in the build" → it
   proves nothing about the binary, and it reads a tree the compiler does not use.
