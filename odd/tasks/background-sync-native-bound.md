# background-sync-native-bound

Supersedes `odd/tasks/background-sync-handoff-bound.md`: its T3 (patch `expo-background-task`) and T6
(force source compilation) are **retracted** — both modify a dependency; its T2, T4 and T5 are carried
over here.

Feature: make the Android background hand-off bounded **from our side**, with the library untouched,
and settle why our headless cycle never terminates.

## Why — what the log already establishes

`docs/mobile-background-sync-investigation-log.md`:

1. **The burn is measured.** Every hung cycle lasts exactly 600.0 s (JobScheduler's window) and
   restarts immediately → 33 jobs/day → Android 15's 6 h `dataSync` budget is exhausted → the FGS can
   no longer start in the background ("se cae"); bringing the app to the foreground resets the timer.
   The proximate cause is that the JS task never acknowledges completion, so the library's unbounded
   `tasks.awaitAll()` never returns and `doWork()` never returns.
2. **A JS-owned bound is already the refuted candidate.** The cycle's own bounds (`withDeadline` 35 s,
   abandonment 45 s) have never been observed firing: `is_cycle_active` stayed `1` across a 600 s hang,
   `consecutive_unclosed_cycles` only incremented after the kill, and the JS thread was measured idle
   in `do_epoll_wait` at 0 % CPU. Any bound that requires our JS to reach a deadline repeats that
   failure. The new bound must not depend on it.
3. **The observability trap.** With `inForeground` stuck true the task is suppressed and the worker
   still reports SUCCESS in 38 ms. The primary acceptance metric is a `sync_cycle_checkpoint` row
   reaching `closed` with the app closed, and `consecutive_unclosed_cycles` staying `0`; the timeout
   count is a secondary signal.

## Why — what today added

4. **The library's Android code is consumed as a prebuilt AAR.** `expo-background-task@55.0.20`
   declares `android.publication` and autolinking links the Maven publication instead of the source
   project (`[📦] expo-background-task (55.0.20)` in the Gradle log; the shipped AAR has the same
   fingerprint as the APK's dex). Patching its Kotlin through `patchedDependencies` is inert by
   construction, and the repo's design rule is that a dependency is never modified — it is composed
   with, or replaced, at our own boundary.
5. **The seam exists outside the library.** Its JS listener does
   `result = await taskExecutor({ data, error, executionInfo })` and only then notifies the native
   side; our task body receives `executionInfo.eventId`. Natively, `expo-task-manager`'s public
   `TaskServiceInterface` exposes `notifyTaskFinished(String taskName, String appScopeKey, Map
   response)` and `handleJob`/`cancelJob`. A closure path therefore exists that is ours to drive — the
   question is only what can drive it when our JS is not reaching its own deadlines.

## Extracted architecture — `syncthing-android` (works, same tablet, same OS)

Source: `D:\dev\random\syncthing-android` (v1.28.1 source; v1.27.3 installed) plus live `dumpsys`
from the tablet, 2026-09-19.

| | Syncthing (works) | autoreas-mobile |
| --- | --- | --- |
| targetSdk | **33** | **35** |
| Background mechanism | one resident foreground service (`SyncthingService`) | Notifee foreground service **+** WorkManager jobs — two schedulers |
| Foreground service type | **none** (`types=0x00000000`) | `dataSync` (`types=0x00000001`) |
| Alive | **2 d 15 h 09 m**; `lastActivity == restartTime` (never restarted) | 2 h 03 m; `createdFromFg=true`, `stopIfKilled=true` |
| Battery-optimisation whitelist | **yes** | **no** |
| JobScheduler entries | none | `SystemJobService` plus others |
| Who schedules | the app itself, in process | the platform (WorkManager, 15 min) |

Mechanism, read from the source:

1. **One service that is the engine.** `SyncthingService` hosts the resident native sync engine; the UI is
   a client. There is no per-run job that must return, so nothing needs to "acknowledge" for the platform
   to be paid back.
2. **Always foreground on Android 8+.** `NotificationHandler.updatePersistentNotification` sets
   `startForegroundService = true` unconditionally — "Always use startForeground. This makes sure the app
   is not killed, and we don't miss run condition events. On Android 8+, this behaviour is mandatory to
   receive broadcasts." It stays foreground even when syncing is disabled, so it can still receive the
   broadcast that tells it to start.
3. **`START_STICKY` + restart.** `onStartCommand` returns `START_STICKY` on every path; the live service
   reports `stopIfKilled=false`.
4. **The app decides when to run.** `RunConditionMonitor` listens for power connected/disconnected and
   `ACTION_POWER_SAVE_MODE_CHANGED` and evaluates the user's conditions in process (charging, Wi-Fi,
   metered), then starts or stops the engine. The platform is not the scheduler.
5. **A wake lock while the engine runs.** `SyncthingRunnable` acquires a `PARTIAL_WAKE_LOCK` before
   launching the native process and releases it when the process ends ("keep the CPU running while native
   binary is running", issue #498); user-toggleable via `PREF_USE_WAKE_LOCK`.
6. **Started from the background.** `BootReceiver` (`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) calls
   `startForegroundService` with the documented Android 8+ workaround, plus an exported
   `AppConfigReceiver` with `START`/`STOP` actions for outside automation.
7. **It asks for the exemption.** `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the manifest, and the device
   confirms the grant. Our app declares it nowhere and has no grant.

The load-bearing difference is a **policy**, not a style: the 6-hour cap applies **only to apps targeting
Android 15 or higher** and **only to the `dataSync` and `mediaProcessing` types—**quoting
`developer.android.com` "Foreground service timeouts": "Currently, this restriction only applies to
`dataSync` and `mediaProcessing` foreground service type foreground services", and past the limit "the
system calls the running service's `Service.onTimeout(int, int)`"; afterwards the app "cannot start
another `dataSync` foreground service unless the user has brought your app to the foreground (which resets
its timer)". Syncthing targets 33 and declares no type, so the regime never applies. We target 35 and
declare `dataSync`, so a resident service is impossible by construction — and the budget is consumed by our
own ten-minute hangs.

There is a **second gate, and it is the one we actually fail today**. Starting a foreground service from
the background is restricted for apps targeting Android 12+; the documented exemptions
(`developer.android.com` "Restrictions on starting a foreground service from the background") include
**"The user turns off battery optimizations for your app"** and the broadcasts
**`ACTION_BOOT_COMPLETED` / `ACTION_LOCKED_BOOT_COMPLETED` / `ACTION_MY_PACKAGE_REPLACED`**. Without any of
them the system throws `ForegroundServiceStartNotAllowedException`. Syncthing passes this gate twice: the
exemption is granted on the device, and it has a `BootReceiver` on `BOOT_COMPLETED` and
`MY_PACKAGE_REPLACED`. Our live service record says `getFgsAllowStart=PROC_STATE_TOP` and
`createdFromFg=true` — our foreground service only ever starts while the app is on screen — we declare no
exemption permission and have no boot receiver. That, more than the six-hour cap, is why background sync
only happens in usage windows.

Three consequences:

- **Two gates, two remedies.** Gate 1 (be able to start and stay): battery-optimisation exemption, a boot
  receiver on `BOOT_COMPLETED`/`MY_PACKAGE_REPLACED`, `START_STICKY`, and asking the user for the
  exemption. This is independent of the type choice and we need it either way. Gate 2 (be able to run
  indefinitely): a type outside `{dataSync, mediaProcessing}` when targeting 35 — the documented escape is
  `specialUse` with its declared subtype — or a lower `targetSdkVersion`. Note that at targetSdk 34 a type
  is **still mandatory**; Syncthing is type-less only because it targets 33.
- **The bound (T2) is still required.** A resident service removes the per-run budget, not the hang.
- **One mechanism, not two.** The WorkManager path and the Notify-driven foreground service overlap today,
  which is what makes every diagnosis ambiguous.

## Goal

A background job whose task is never acknowledged ends as a **bounded** failure produced by code we
own, with `expo-background-task` untouched, and the log records which link was true.

## Non-goals

- No modification of `node_modules/expo-background-task` (patch, `patchedDependencies`, forced source
  compilation) and no hand-editing of its prebuilt AAR.
- Not fixing sync semantics. Bounding the hand-off stops the 600 s burn and makes the failure cheap; it
  does not make sync work.
- No change to `sync_runtime_status`, its writers or its schema. No battery exemption, no Doze
  whitelist (both refuted in the log).
- No Kotlin whose only purpose is to move the guarantee back into JS.

## The decision this feature must close first

Two mechanisms; the choice is evidence, not taste.

- **A — Finish the in-flight task from our module.** Our native module obtains the task service and
  completes the running task at its own deadline. Open detail: `TaskService.notifyTaskFinished` is
  keyed by the `eventId`, and `sEvents` / `sTaskCallbacks` are private, so the id must be reachable
  through a public path (or our module must become a `TaskConsumer` of its own type).
- **B — Own the execution.** Our module runs the headless task under its own WorkManager work and
  enforces the timeout natively, so the library's unbounded await is not on the path at all.

T1 decides A vs B by reading the installed APIs.

## Tasks

### T1 — Verdict (2026-09-19): A is not reachable through public APIs; B is

**A — finish someone else's in-flight task — is not implementable.**
- `TaskServiceInterface.notifyTaskFinished(taskName, appScopeKey, response)` resolves completion through
  `response["eventId"]`, and the registries it needs (`sEvents`, `sTaskCallbacks`) are private statics of
  `expo-task-manager`'s `TaskService`. No public member enumerates in-flight events, so a module that did
  not originate the execution cannot address it; calling it with a wrong id silently does nothing.
- `handleJob` / `cancelJob` are only callable from a `JobService` subclass, and this app's path is
  WorkManager (`BackgroundTaskWork.doWork()`), not `JobService`.
- The library runs only its own consumer class: `BackgroundTaskScheduler.runTasks` does
  `consumers.filterIsInstance<BackgroundTaskConsumer>()`, so a consumer we register for the same task
  type is never executed by the library's run.

**B — own the execution — is implementable with public API only.**
- `TaskServiceProviderHelper.getTaskServiceImpl(context)` returns the public `TaskServiceInterface`.
- `TaskConsumerInterface.didRegister(TaskInterface)` hands the `TaskInterface` to the consumer that owns
  it, and `registerTask(name, appScopeKey, appUrl, consumerClass, options)` is public — so a consumer of
  ours can be registered and will receive its own task.
- `TaskInterface.execute(Bundle, Error, TaskExecutionCallback)` is public and delegates to
  `TaskService.executeTask`, which registers the caller's callback, mints the execution event and calls
  `maybeStartHeadlessTask(appScopeKey)`. That last call is exactly where the installed `expo-task-manager`
  keeps JS timers alive (`JavaTimerManager` pauses timers when `isPaused=true && isRunningTasks=false` —
  the comment is in the installed source), so our own execution inherits the same protection.
- The bound then lives in our worker: a timeout around the await, and the worker returns
  `Result.success()` / `Result.retry()` regardless. The job slot is released because the worker we own
  returns; the library's unbounded `awaitAll()` is not on the path at all.

**Consequence for T2:** our own consumer + our own WorkManager work + our own timeout. Cleaning up the
abandoned event (`is_cycle_active` staying `1`) is T5's problem, not this one; today's behaviour is not
made worse by it.

- Evidence: `TaskServiceInterface.java` (`notifyTaskFinished`, `registerTask`, `getTaskConsumers`),
  `TaskService.java:378-441` (`executeTask` → `sTaskCallbacks`/`sEvents` private, `maybeStartHeadlessTask`),
  `TaskManagerUtils.java:74`, `Task.java:57-59`, `TaskConsumer.kt`, `TaskInterface.java`,
  `BackgroundTaskScheduler.kt` (`consumers.filterIsInstance<BackgroundTaskConsumer>()`),
  `BackgroundTaskWork.kt`, `TaskServiceProviderHelper.kt`.

### T2 — Implement the bound in our module
- Surfaces: `modules/` (extend `modules/foreground-sync-ticker` or add a sibling), plus the JS task
  wrapper only if the watchdog must be started from JS.
- Requirement: a closure that does not depend on JS reaching a deadline. The cycle's own JS bounds stay
  as they are; they are not the guarantee.
- Evidence: focused tests for the JS trigger; the Kotlin change checked against the non-goals.

### T3 — Make the closure observable
- Surfaces: our module + the sync diagnostics path.
- Requirement: distinguish "the task really ran" from "the worker returned SUCCESS without running"
  (the `inForeground` trap), and record which path closed the cycle (normal acknowledgement vs
  watchdog).
- Evidence: a checkpoint or telemetry row naming the closing path.

### T4 — Device verdict (the decisive experiment)
- Requires T2 installed; app genuinely closed; the next natural run (a forced job is not a
  deterministic harness).
- Pass: the job ends bounded with the log showing the watchdog closure, and the outbox `elapsed_ms`
  stays within the app's own abandon budget (p95). Fail: it still burns 600 s.
- Evidence: `dumpsys jobscheduler` before/after, the log line, the timings; the verdict recorded
  either way, including the counter-case.

### T5 — Why our cycle never terminates (carried over)
- Surfaces: `src/features/sync/` — checkpoints in the `backlog_read → http` gap and on the
  abandonment path.
- Requirement: a stage name for the stall; extend `SYNC_CYCLE_STAGES` deliberately or record the
  reuse choice. Do not invent a label silently.
- Evidence: the new stages appearing in `sync_cycle_checkpoint`, with cycle id and offsets.

### T6 — Retire the patch artifacts
- Surfaces: `patches/`, `package.json`, `bun.lock`, `docker-compose.eas.yml`.
- Requirement: remove the patch file, the `patchedDependencies` entry, the lockfile entry and the guard
  that greps a tree the compiler never reads. The log keeps the record of why they were wrong.
- Evidence: the diff, and a build that still succeeds.

### T7 — Adopt the resident-service architecture for the sync scheduler
- Surfaces: `modules/foreground-sync-ticker` (or a sibling module), `app.json` / the Android plugin,
  `src/features/sync/`
- Requirement: one foreground service that owns the cycle schedule and evaluates run conditions in
  process, `START_STICKY`, with a persistent notification and a wake lock held only while a cycle runs. The
  periodic path stops being routed through WorkManager. It must also pass **Gate 1**: a boot receiver on
  `BOOT_COMPLETED` / `MY_PACKAGE_REPLACED` and the battery-optimisation exemption requested from the user,
  without which the service cannot start from the background at all.
- Evidence: `dumpsys activity services` shows our service foreground after a cold boot with the app never
  opened; the notification is present; a cycle's `elapsed_ms` is bounded; no JobScheduler entry for sync.

### T8 — Decide the foreground-service type / targetSdk policy (maintainer decision)
- Surfaces: `app.json` (`expo-build-properties` → `targetSdkVersion`), the Android manifest plugin
- Options, each with its cost:
  1. **targetSdk 35 + `specialUse`** (with the subtype property): the cap's documented list is only
     `dataSync` and `mediaProcessing`, so this type runs indefinitely. Cost: a declaration the platform
     treats as "does not fit another type", currently a formality for a sideloaded APK and a review item if
     the app ever ships on Play; Google could add more types to the capped list later.
  2. **targetSdk 34 + `dataSync`**: the cap requires targeting 35+, so this escapes it, and the type is
     still declared. Cost: the whole app freezes at Android 14 behaviours, and raising `targetSdkVersion`
     later walks straight back into the cap.
  3. **targetSdk 33 with no type**, Syncthing's exact position: maximal immunity, maximal distance from the
     modern contract. Not recommended; recorded only to show what the neighbour actually does.
  4. **Keep `dataSync` at 35**: no resident service is possible; background sync depends on short budgeted
     bursts, so it is viable only once a cycle is guaranteed to finish in seconds — and Gate 1 still has to
     be passed or the service cannot even start.
- Evidence: the chosen value in `app.json` and the resulting `types=` in `dumpsys`.
- **Decided 2026-09-19: keep targetSdk 35 and declare `specialUse`.** Exact requirements
  (`developer.android.com`, "Foreground service types"): the type string is `specialUse`, the permission
  is `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`, and the service must carry
  `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="…"/>`. A Play
  Console declaration is required "when you submit your app in the Google Play Console" — we ship
  sideloaded APKs, so it does not apply today.
- Where it goes: `plugins/withAndroidForegroundSync.js`. That plugin is already the single source of this
  attribute — it sets `android:foregroundServiceType` on `app.notifee.core.ForegroundService` and adds the
  matching `FOREGROUND_SERVICE_DATA_SYNC` permission, because "react-native-notify-kit … no longer
  hardcodes `android:foregroundServiceType`" and "Android 14+ refuses to start a foreground service
  without it". The type we must change is therefore ours to change.
- **Applied 2026-09-19 and verified in the artifact.** The plugin now declares `specialUse` plus the
  subtype property. `aapt2 dump xmltree` on `build-1789875742678.apk` reports
  `android:foregroundServiceType(0x01010599)=0x40000000`, the `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property
  with its value, and the permission; the installed package shows
  `android.permission.FOREGROUND_SERVICE_SPECIAL_USE: granted=true`.
- **First install crashed the app, and the crash is instructive.** Our own JS call site named the type
  explicitly (`foregroundServiceTypes: [FOREGROUND_SERVICE_TYPE_DATA_SYNC]` in
  `notifee-foreground-service-adapter.helpers.ts`), so `startForeground` asked for `0x00000001` while the
  manifest declared `0x40000000`: `IllegalArgumentException: foregroundServiceType 0x00000001 is not a
  subset of foregroundServiceType attribute 0x40000000 in service element of manifest file`. The fix is
  in our code, not the library: request `FOREGROUND_SERVICE_TYPE_MANIFEST` (`-1`), which
  `resolveManifestServiceType()` resolves against the declared attribute, so the plugin is the single
  source of truth and the two cannot drift again. Covered by a RED→GREEN test that also asserts
  `DATA_SYNC` is not requested. Confirmed on the device: the app launches with no crash.
- **Live reading, 2026-09-19:** with the app opened, `dumpsys activity services` reports
  `isForeground=true types=0x40000000` (specialUse) with the persistent `autoreas-sync-foreground`
  notification, and logcat shows no crash. The six-hour `dataSync` cap no longer applies to this service.
  What remains is Gate 1: the service still only starts from the foreground (`createdFromFg=true`), is not
  restarted if killed (`stopIfKilled=true`), has no boot receiver and no battery-optimisation exemption.

### T9 — Decide where the sync loop lives (JS or native)
- Surfaces: `modules/` (native loop) versus `src/features/sync/` (JS loop)
- The survival question and this one are independent. Two shapes:
  1. **Resident service + the existing JS cycle.** Least code. Keeps the whole JS-headless failure class:
     paused timers, a promise that must settle for anything to advance, the shared write door, the
     `expo-background-task`/AAR layering.
  2. **Resident service + a native cycle** (Kotlin owns read backlog → claim → HTTP → apply → prune, with
     the checkpoints written from Kotlin). Removes that entire class, and with it
     `expo-background-task`, the bound problem (T2 becomes trivial) and the patch question (T6 dissolves).
     Cost: the loop is rewritten natively, bounded work, but the data model is small and the bridge
     protocol is JSON.
- Whichever shape is chosen, the checkpoints move with the loop so the diagnosis survives the change.
- Evidence: the decision recorded here, and the loop's own checkpoint rows naming its stages.

## Sequence (agreed 2026-09-19)

- **P1 = T6.** Delete the retracted patch artifacts: `patches/`, the `patchedDependencies` entry, the
  `bun.lock` entry, and the compose guard that greps a tree the compiler never reads.
- **P2 = T8 applied.** `specialUse` + `FOREGROUND_SERVICE_SPECIAL_USE` + the subtype property on the
  service, keeping Notifee as the owner for this step so the delta stays one file. Rebuild, then verify on
  the device that `types=` carries the special-use bit and that neither `Service.onTimeout` nor
  `ForegroundServiceStartNotAllowedException` appears.
- **P3 = T7.** Lift ownership into our own service: `START_STICKY`, boot receiver, persistent
  notification, wake lock held **only while a cycle runs**, the bound in our own code, and run conditions
  evaluated in process. The cycle stops being routed through `expo-background-task`/WorkManager.
- **P4 = T3.** Observable closure: distinguish a real run from a no-op SUCCESS, and record which path
  closed the cycle.
- **P5 = T5.** Bisection for why the cycle does not finish, starting from an empty cycle.
- **T9 stays open** as the escape hatch if the JS loop keeps dying.

Note for P3, found while reading our own module: `modules/foreground-sync-ticker` holds the
`PARTIAL_WAKE_LOCK` for the **entire ticking lifetime**, and its comment defends that deliberately
(`Handler.postDelayed` schedules against `SystemClock.uptimeMillis()`, which freezes while the CPU is
suspended, so a per-tick lock leaves the interval unprotected). Syncthing's pattern instead holds the lock
only while the engine runs. T7 must hold it per cycle and keep the cadence from a source that does not
freeze — the two requirements have to be solved together, not one at the cost of the other.

## Acceptance

T1's verdict is recorded; T4 has a recorded verdict on the bounded closure; T5 names the stall stage;
T6 leaves no patch pointing at the library.

## Checks

- Focused: `npx jest <focused paths> --maxWorkers=4`
- Gate: `npx lefthook run pre-commit` with the files staged
- Types: `npx tsc --noEmit`
- Native: T2 needs a rebuild before T4 can observe anything

## Work units

One commit per task, Conventional Commits, tests and docs alongside the behaviour; commits are
prepared and held until the maintainer confirms, per `AGENTS.md`.

## Live verdict — 2026-09-20, app closed ~9 h (the free experiment)

Read from the tablet (SM-X800, Android 15, `R52T30686RV`) at 10:20–10:26, with the app never brought
to the foreground after the 2026-09-19 session.

**What survived.** The process is 11 h 17 m old; the Notifee `ForegroundService` was created
11 h 10 m ago, last (re)started 8 h 43 m ago, and still reads `isForeground=true types=0x40000000`
with the `autoreas-sync-foreground` notification posted. No `Service.onTimeout`, no
`ForegroundServiceStartNotAllowedException`, no `FATAL`/`ANR` in an 8.5 h logcat buffer. The six-hour
`dataSync` cap is dead, exactly as T8 predicted; the special-use type carried the service past 8.7 h.

**What did not happen: not one cycle closed.** `files/SQLite/autoreas-telemetry.db` →
`sync_diagnostics_outbox`, pulled off the device, reports **34 consecutive `never_closed` cycles**
from 01:18 to 10:20, `last_stage = attempt_started` in all of them, `elapsed_ms` clustered at
600–615 s (the platform's execution-guard kill), with outliers at 813 s, 860 s, 1 463 s and **9 061 s**,
and `error_name` empty by construction. `JobServiceContext` logs the kill each time: `Client timed out
while executing (no jobFinished received)`.

**The stall is one write, inside the reconcile pass.** The out-of-door instrument
(`sync_cycle_checkpoint`, its own file and connection) puts the furthest stage at **`claim_ops`,
261 ms into the cycle**, and the stage stayed there across three samples (169 s / 204 s / 272 s) while
the same cycle ran. `reconcile.helpers.ts` publishes `claim_ops` under ENTRY semantics — before the
await — so the hang is the `withLocalWrite` that marks the batch `processing`: the first write through
the shared door inside reconcile. Everything before it returned; `recordSyncAttemptStarted` and
`recordCycleActive` are door writes too, and both completed.

**Consequence the platform now adds: our timeouts are restricting the app.**
`AppStandbyController: Tried to restrict recently used app: com.disble.autoreasmobile due to 1540`
appears twice in the buffer, and `am get-standby-bucket` answers **45 (RESTRICTED)**, which cuts the
JobScheduler quota. A 600 s burn no longer costs only battery; it costs the quota the scheduler needs.

**Gate 1 is untouched.** `deviceidle whitelist` has no entry for the package,
`getFgsAllowStart=PROC_STATE_TOP`, `createdFromFg=true`, `startCommandResult=2` (START_NOT_STICKY).
The service survived because the platform never killed it — not because it can come back.

**Open mechanism (T5, narrowed).** The cycle neither closes nor errors even though
`LOCAL_WRITE_DEADLINE_MS = 20_000` wraps that write and the error triple stays empty: either the
deadline's timer never fired — a frozen JS thread — or the parked await sits outside the bounded
caller's path. `autoreas.db-wal` is 1.4 MB while the main file has not been touched since
2026-09-19 00:38 (no checkpoint in ~34 h), which is consistent with a write transaction held open
across cycles, but the pulled copy is a snapshot and cannot prove it. The bisection this log already
prescribes (empty cycle, then stages re-added one at a time) is the next instrument, not more reading.

**Order this verdict argues for.** T2 before T7: the park costs the app its standby bucket on every
cycle, and a bound in our own worker stops that bleeding whether or not T7/T9 change the architecture.
T9 remains the maintainer's decision, and T7 depends on it.

## Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | done | Verdict above: A unreachable (private event registry, `JobService`-only cancel, `filterIsInstance<BackgroundTaskConsumer>()`); B implementable with public API (`TaskServiceProviderHelper`, `didRegister` → `TaskInterface`, `TaskInterface.execute`). |
| T2 | pending | |
| T3 | pending | |
| T4 | pending | |
| T5 | open — localized to one write | Live verdict above: `claim_ops` at 261 ms, parked 272 s and counting in the `withLocalWrite` that marks the batch `processing`; error triple empty across 34 `never_closed` cycles. The mechanism (frozen JS thread vs. an await outside the bounded caller) is not yet decided. |
| T6 | **done** (the table said `pending`; corrected here) | `patches/` gone, `patchedDependencies` absent from `package.json`, the patch preserved outside the repo at `/tmp/retired-expo-background-task-patch/expo-background-task@55.0.20.patch`, and the lockfile validated with the container's exact command (`bun install --frozen-lockfile` → 1425 installs, no changes). |
| T7 | pending | |
| T8 | **done and verified live: `specialUse` @35** | Docs, then the built APK's binary manifest (`0x40000000` + subtype property), then the installed package's grants, then the runtime: `isForeground=true types=0x40000000`, no crash. The follow-up crash was our JS call site naming `data_sync`; it now requests the manifest sentinel. |
| T9 | pending | Maintainer decision: shape of the loop. |
