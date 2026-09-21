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

*Last updated: 2026-09-20, third session — the root cause below.*

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
pending the build carrying `4654779` (registration) and `3e6e10b` (start ordering, which also keeps
the cold-start callback).** Full entry: "2026-09-20 — the root cause: the modules were never
registered", in the log below.

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

1. **Run the device acceptance checklist** (`odd/tasks/mobile-sync-native-engine.md`): with the
   root-cause fixes in place (`4654779` registration, `3e6e10b` ordering, plus `cf71725`, `e038901`),
   confirm the ticker wake lock, the `SyncEngine: runOnce invoked (...)` logcat line,
   `files/sync-journal.db` created with transition rows, a fresh `last_attempt_at`, and the attempt
   bounded to 30 s instead of dying at 600. No `[nativeSeam]` warning may appear in logcat.
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
runs the ten acceptance checks in order (device attached, build identity, lab-readable build, service
state, ticker wake lock, engine invoked, journal written, attempt freshness, no execution-guard burns,
stand-by bucket), prints `PASS`/`FAIL`/`UNKNOWN` per check with the raw evidence it read, and exits
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
