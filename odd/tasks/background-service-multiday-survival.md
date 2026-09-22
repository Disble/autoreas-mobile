# background-service-multiday-survival

Feature: make the Android foreground sync service survive multi-day screen-off periods instead of
dying silently the first time one tick is not delivered.

Status: planning. Branch `fix/background-service-multiday-survival`, cut from `dev` at `7c45a6a`.

Delivery strategy: `single-pr`. Changed from the `ask-on-risk` default deliberately: this repository
has no pull-request process at all — its recorded delivery model is a local merge to `main`, and the
`mobile-release` skill only adds a pushed tag on top of that. The ~400-line budget exists to protect
reviewer focus, and there is no reviewer to protect, so slicing this into a chain would buy nothing
and cost the coherence of a fix whose parts only work together. The work is still split into
work-unit commits (one per task), which is where the review value actually lives here.

TDD: enabled. Source: user `CLAUDE.md` ("Strict TDD Mode: enabled") and project `CLAUDE.md`
(RED → GREEN → MUTATE → REFACTOR). Runner: `bun run test` (`jest --maxWorkers=4`); focused runs
use `bunx jest <path>`. The real local gate is `npx lefthook run pre-commit`.

## Why

Reported by the maintainer on the installed `1.4.1` build: the background service was down after an
overnight screen-off. Device evidence collected the same morning on tablet `R52T30686RV`
(Galaxy Tab S8+, `SM-X800`, device uptime 23 h 56 m at the time of capture):

- `usagestats` `lastTimeFS="2026-09-22 02:12:31"` — the foreground service stopped at 02:12:31.
- At 02:13:29 the last pending `TICK_ALARM` broadcast fired and was delivered to **zero** receivers:
  `Received BROADCAST intent ... act=expo.modules.foregroundsyncticker.TICK_ALARM ... sent=0`.
  That is the only `TICK_ALARM` line in a ~7.5 h buffer; at a 60 s cadence there should be hundreds.
- 03:24:32 `Killing 23974:com.disble.autoreasmobile (adj 850): kill background`, restarted **only**
  for `androidx.work.impl.background.systemjob.SystemJobService`.
- 09:38:11 Samsung's `ChimeraAggressivePolicyHandler` killed it again at `adj 850`.
- At capture time: `adj 250`, procState `TRNB`, capability `-------T` (**no `F` foreground-service
  flag**), no posted notification, no `ForegroundSyncTicker:ticking` wake lock, and **zero**
  `Background started FGS: Allowed` lines for the package in the whole buffer.

Three compounding defects explain it by construction:

1. **The tick receiver is context-registered, not manifest-declared.**
   `ForegroundSyncTickerModule.kt:115-122` registers `tickReceiver` on `appContext.reactContext`, so
   it dies with the React Native context. The alarm itself lives in the system `AlarmManager` and
   outlives the process — it fires into a void. That is the `sent=0`.
2. **The reschedule lives inside the delivery path.** `scheduleNextTick()` is called only from
   `dispatchTick()` (`ForegroundSyncTickerModule.kt:77`). One undelivered broadcast ends the cadence
   permanently. There is no redundancy and no re-arm on process start.
3. **Nothing can restart the FGS from the background.** `dumpsys activity services` reports
   `getFgsAllowStart=DENIED`, `getFgsAllowStart_new=DENIED`, `mAllowStart_noBinding=DENIED`, and the
   app is absent from `dumpsys deviceidle whitelist`. On `targetSdk 35` a background
   `startForegroundService` throws `ForegroundServiceStartNotAllowedException`. `expo-background-task`
   (WorkManager job `#305`) revives the *process* for `runHeadlessSyncCycle`, but it is a sync
   fallback, not an FGS watchdog.

Without the FGS the process sits at `adj 850` (cached/empty) and is free LMK food. Both overnight
kills are **correct** Android behaviour for a process with no foreground service.

### Control experiment, same device, same night

Syncthing (`com.nutomic.syncthingandroid`) was installed on the same tablet and its
`SyncthingService` reported `createTime=-1d0h1m33s` — continuous since boot, through the same Doze
cycles that killed ours.

| | Syncthing (24 h alive) | Autoreas (dead) |
|---|---|---|
| oom adj | 200 (`fg-service`) | 250 (`TRNB`) |
| capability | `---NFU-T` (has `F`) | `-------T` (no `F`) |
| `getFgsAllowStart` | `SYSTEM_ALLOW_LISTED` | `DENIED` |
| Doze allowlist | yes, scope `user` | **no** |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | `granted=true` | **not even declared** |
| wake locks held | **zero** | zero |

Syncthing holds no wake lock. It does not fight CPU suspension; the user-granted battery-optimization
exemption is what lifts Doze's restrictions and flips `getFgsAllowStart` to `SYSTEM_ALLOW_LISTED`.

### Ruled out

- **Not a crash or ANR** — `dumpsys dropbox` has no `com.disble.autoreasmobile` entries on 09-21 or
  09-22 (the last are 09-19 and 09-20).
- **Not Android 15's 6 h `dataSync` cap** — `plugins/withAndroidForegroundSync.js:25` declares
  `specialUse`, which is exempt from that timeout. That choice was already correct.
- **Not Samsung "sleeping apps"** — `sem_deep_sleeping_apps_list` and `sem_sleeping_apps_list` are
  both `null`.

### Still unproven

**What stopped the FGS at 02:12:31 is not known.** The system logcat buffer begins at 02:12:40, nine
seconds too late. This feature fixes the defect by construction — it makes the service recoverable
whatever stopped it — rather than waiting to reproduce a trigger we cannot yet observe. Capturing it
needs `adb logcat -G 64M` plus a persistent logcat-to-file before screen off.

## Goal

After the FGS stops for any reason, the app re-establishes it without user interaction, and the tick
cadence re-arms itself without depending on the previous tick having been delivered.

## Non-goals

- **No permanent wake lock.** Syncthing proves it is unnecessary, and Doze ignores wake locks anyway
  for apps that are not exempt. The per-cycle wake lock stays exactly as it is.
- **No change to the `specialUse` foreground-service type.** It is already correct and exempt from
  Android 15's 6 h timeout.
- **No attempt to reproduce the 02:12:31 trigger.** See "Still unproven".
- **No change to the sync cycle, the reconcile protocol, or the attempt-policy backoff ladder.**
  Only the cadence's documented premise changes, not its base interval.
- **No Play Store submission work.** Both `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` and `specialUse`
  need a justification at review time; this app ships as a sideloaded APK, so that cost is recorded
  here and not paid.

## Decisions

- **The battery-optimization exemption is requested, never assumed.** It is exemption #13 on
  Android's official background-FGS-start list and the only one this app can reach. The user grants
  it through the system dialog; the app must keep working, degraded, when it is refused.
- **`setExactAndAllowWhileIdle` becomes available for free once exempt.** Android documents that
  apps targeting SDK 31+ need `SCHEDULE_EXACT_ALARM` to use it *unless the app is exempt from battery
  restrictions*. So the exemption buys precision without a second user-revocable permission.
- **The documented allow-while-idle floor is nine minutes, not one.**
  `ForegroundSyncTickerModule.kt:151-153` claims "floor ~1/minute". Android's Doze documentation
  states: "Neither `setAndAllowWhileIdle()` nor `setExactAndAllowWhileIdle()` can fire alarms more
  than once per nine minutes, per app." `FOREGROUND_SYNC_INTERVAL_MS` stays at `60_000` — the
  interval was never the defect — but the comment stops asserting a floor the platform does not
  promise. **Whether the Doze allowlist lifts that specific quota was NOT verified and must not be
  assumed.**
- **Re-arm is idempotent and owned by process start**, not by tick delivery.

### Decisions forced by the code map

- **A manifest receiver cannot deliver `onTick`, and must not try.** Android instantiates a
  manifest-declared receiver with no reference to the Expo module instance, in a process where the
  React Native context may not exist at all — which is exactly the state this bug leaves behind. So
  the responsibility splits: the manifest receiver owns **re-arming the next alarm and ensuring the
  FGS is up**, both of which are pure platform calls needing no JS; delivering `onTick` to JS stays
  with the module instance and only happens when one is alive. This is why T2 and T3 are one work
  unit — the receiver *is* the re-arm site.
- **The receiver is declared in the config plugin, not the local module's manifest.** The map found
  no manifest-declared component anywhere in the repo: `foreground-sync-ticker`, `sync-engine` and
  `sync-journal` all keep their own `AndroidManifest.xml` empty and every app-level manifest edit
  goes through `plugins/withAndroidForegroundSync.js`. Following the house convention beats
  inventing a second wiring location. `ensureSpecialUseSubtypeProperty` (line 63-74) is the
  idempotent array-push template; `mainApplication.receiver` is the array.
- **The battery-exemption API lands in `foreground-sync-ticker`, and that module's stated
  responsibility widens.** There is no prior art anywhere in this repo for requesting a special
  permission or opening a system settings screen — zero matches for `Linking.openSettings`,
  `ACTION_REQUEST_*`, or any battery-optimization API. A new local Expo module would cost a
  `expo-module.config.json`, a `build.gradle`, a manifest, a JS seam and its tests for two native
  calls. Renaming the existing module would break prebuild for no user-visible gain. So the module
  keeps its directory name and its doc comment is rewritten from "only supplies the tick source" to
  the native surface that keeps foreground sync alive: tick source, alarm re-arm, and the
  battery-optimization exemption. **This is a deliberate widening of a module's contract, recorded
  here so it is not mistaken for drift.**
- **Direct request, not the settings list.** With `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` declared,
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` shows a one-tap system dialog;
  `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` only opens a list the user must then navigate. The
  direct action is a Play policy flag, which costs nothing here because this app sideloads.
- **The new status field ripples further than the adapter.** `isBatteryOptimizationExempt` has to be
  added to the shared `SyncExecutionStatus` type, to both status builders in the adapter
  (`getStatus()` at helpers.ts:297-309 and `createUnsupportedStatus()` at 26-35), to
  `createFallbackStatus` / `mergeConcurrentSyncExecutionStatus` in
  `sync-execution-facade.helpers.ts`, and to **seven full-object `toEqual` assertions** in
  `tests/features/sync/notifee-foreground-service-adapter.test.ts`. Those assertions are full-shape
  by convention, so a missed one fails loudly rather than silently — which is the point.
- **`MetricTile` has no `onPress`.** The exemption row needs an action, and the tile grid is
  presentational by design (`SettingsMetricTile.tsx` renders a bare `View`). Rather than make every
  tile pressable, T5 adds one dedicated action row mirroring the existing `SettingsSyncCard` action
  button, which is already the repo's precedent for a tappable settings action.

## Verification

`jest-expo` cannot observe a real alarm, a real broadcast, or a real foreground service. Kotlin has
no test harness in this repo. So this change verifies JS-side seams and plugin output in Jest, and
its native and device claims are verified on the attached tablet by hand, recorded per task.

Per task: `bunx jest <path>` for the focused suite, then `npx lefthook run pre-commit` before the
commit. Before the tag: `bun run typecheck && bun run test` (`bun run validate` fails repo-wide on
standing `dharness` lint debt — see the `mobile-release` skill).

## Delivery forecast

The pre-map estimate of ~380 authored lines was **wrong and is retired**. With the map in hand the
honest forecast is **~700-800** (additions + deletions, generated files excluded), driven by three
things the estimate missed: the battery-exemption surface has no prior art and needs native Kotlin
plus a JS seam plus types plus tests; the new status field ripples through a shared type, two status
builders, two facade merge helpers and seven full-shape test assertions; and the Settings action row
cannot reuse the presentational tile grid.

That is over the ~400 budget. Under the `single-pr` strategy recorded above that does not trigger a
chain — there is no PR to split — but it does mean the **work-unit commits carry the whole review
burden**, so each one must stand alone with its tests and docs.

Work units, one commit each:

| Commit | Tasks | Why it stands alone |
|---|---|---|
| 1 | T1 | The exemption surface is independently useful and independently verifiable on device |
| 2 | T2 + T3 | The receiver *is* the re-arm site; splitting them ships a receiver that does nothing |
| 3 | T4 | The watchdog depends on T1's exemption but not on T2/T3 |
| 4 | T5 | Observability and the CI guard; no behaviour change |
| 5 | T6 | Release mechanics only |

## Tasks

### T1 — Declare and request the battery-optimization exemption

Add `android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` to `withAndroidForegroundSync.js`, and
a JS seam that reads the current exemption state and opens the system request. Degrades honestly when
refused.

Status: **done**, commit `45db1ed`. Route: delegated writer (writer trigger — 6 files, 2 of them
native/plugin with no prior art). 244 insertions, 4 deletions.

Evidence: RED observed first (`Cannot find module '.../native-battery-optimization.helpers'`, 1 suite
failed, 0 tests). GREEN 5/5. MUTATE: `?? false` replaced with a hardcoded `return false` in both seam
methods, 2 of 5 tests failed as expected (`Expected: true / Received: false`), restored with
`git checkout -- <file>` from the index. Gate: `npx lefthook run pre-commit` green — lint, fallow,
typecheck, 181 suites / 1380 tests, mutation guard.

**Defect caught in review, before the commit.** The writer guarded the intent launch behind
`intent.resolveActivity(packageManager)`. That call is subject to Android 11+ package-visibility
filtering and this app targets SDK 35, so without a `<queries>` entry it can return `null` for an
intent `startActivity` resolves fine — failing closed, and silently, on exactly the devices the
exemption matters most on. Removed; the existing `catch` turns a genuinely absent activity into the
same `false` with no false negative. The reason is recorded in the KDoc so it is not reintroduced.

**Gap noted, deferred to T5.** `scripts/dlinter-mutation-staged.mjs` has exactly one configured
mutation surface (`native-foreground-sync-ticker.helpers.ts`), so the gate's mutation guard did not
cover the new seam — only the writer's manual MUTATE step did. Add the new helper to that config.

### T2 + T3 — Manifest receiver that re-arms without the previous tick

One work unit, for the reason recorded under "Decisions forced by the code map": the receiver is the
re-arm site, so a receiver without the re-arm ships dead code.

Declare the `TICK_ALARM` receiver through `withAndroidForegroundSync.js` (`mainApplication.receiver`,
following the `ensureSpecialUseSubtypeProperty` idempotent-push template) so it survives process
death, and drop the context-registered one. The receiver re-arms the next alarm and ensures the FGS
is up — both pure platform calls. `scheduleNextTick()` stops being reachable only from
`dispatchTick()`; it is also called on process start and on receiver entry, idempotently, so a lost
broadcast costs one interval instead of the whole cadence. Delivering `onTick` to JS stays with the
live module instance.

**Refinement decided before implementation: the receiver does NOT restore the foreground service.**
The first sketch had it re-arm *and* ensure the FGS was up. That is wrong on inspection: Notifee owns
the FGS and its notification, so restoring it means going through Notifee's JS API
(`adapter.register()`), which a bare Kotlin `BroadcastReceiver` in a process with no React Native
context cannot call. Reaching for `app.notifee.core.ForegroundService` directly from Kotlin would
fork ownership of the service between two layers — exactly the kind of second wiring location this
document already rejected for the manifest.

So the split is: **the receiver owns the alarm, T4 owns the service.** The receiver does pure
platform work — re-arm the next alarm, and dispatch `onTick` only if a live module instance is there
to receive it. Restoring the FGS goes through the JS path that already exists, driven by T4's
watchdog on a headless wake, which T1's exemption is what makes legal.

**Consequence that must not be missed: the re-arm has to be conditional, or it becomes a battery
bug.** A receiver that re-arms unconditionally would wake the CPU every 60 s forever with no FGS and
no JS to do anything — worse than the bug being fixed. The ticking intent therefore has to outlive
the process: persist `isTicking` and `intervalMs` (SharedPreferences), re-arm only while the
persisted flag says ticking is enabled, and have `stop()` clear it.

Status: **done**, commit `1098d10`. Route: delegated writer (writer trigger — 5 files across Kotlin,
the config plugin and a new test directory). 474 insertions, 82 deletions.

Shipped: `TickAlarmScheduler.kt` (shared constants, persisted `TickingState`, the single
`buildTickPendingIntent`, `scheduleNextTick` / `cancelTickAlarm`), `TickAlarmReceiver.kt` (the
manifest receiver), the module losing its context-registered receiver and gaining a `@Volatile`
`activeInstance` set in `OnCreate` and cleared in `OnDestroy`, `onAlarmReceived()` for dispatch-only,
`reArmFromPersistedState()` on `OnCreate`, and `ensureReceiver` in the config plugin with
`android:exported="false"`.

Evidence: focused suite 5/5 (`tests/plugins/with-android-foreground-sync.test.ts`, spot-checked by
the parent). MUTATE: the idempotence guard in `ensureReceiver` deleted, `is idempotent` and `updates
an existing receiver` both failed with `Expected length: 1, Received length: 2`, restored with
`git checkout --` from the index. Gate green on commit: lint, fallow, typecheck, 182 suites / 1385
tests, mutation guard.

**The RED for this work unit was reconstructed, not written first, and that is worth recording
honestly.** The writer implemented before testing, then reverted only `withAndroidForegroundSync.js`
to `HEAD` to produce the failure. The output is a real failure for the real reason — 3 of 5 failed,
and the 2 that passed were the permission and service assertions the change does not touch, which is
exactly right — but it is not RED-first, so it did not get the design pressure a true RED gives. The
test is sound; the discipline slipped.

**Considered and rejected:** switching the alarm `PendingIntent` from
`Intent(TICK_ALARM_ACTION).setPackage(packageName)` to an explicit
`Intent(context, TickAlarmReceiver::class.java)`. An explicit component is marginally more robust,
but `setPackage()` is the documented way a manifest receiver legally receives an app's own broadcast
under Android 8+'s implicit-broadcast ban, so the current form is correct. Churning a working
keystone delivery path without evidence of a defect is not an improvement.

### T4 — FGS watchdog

A periodic check that notices the FGS is down and re-establishes it through `adapter.register()`,
which T1's exemption makes legal from the background. Must not fight the existing
`expo-background-task` sync fallback — it rides the same headless wake rather than adding a second
scheduler.

**Blocking gap found during T4, and the decision that closed it.** The writer stopped before writing
code to ask how a watchdog running in a headless wake learns whether the FGS is actually up. The
investigation was correct and is worth keeping:

- The adapter's `isForegroundServiceRunning` and the ticker seam's `isRunning()` are plain closure
  state. `createNotifeeForegroundServiceAdapter()` returns a NEW object every call, always starting
  at `false`, so any instance the watchdog builds is blind to whatever the live app built. Headless,
  this is not a weak signal — it is no signal.
- The persisted `sync_runtime_status.isForegroundServiceRunning` flag is written **only** from the
  live foreground runtime. Nothing writes it when the service dies silently in the background — that
  silence *is* this bug. Trusting it would make the watchdog read `true` for exactly as long as the
  defect has been running.
- The `executionMode` half of that same row is sound, because it only flips on an explicit
  register/unregister. It answers "is the app supposed to be in FGS mode", which is a different and
  genuinely persisted question.

Decision: **add a native `isForegroundServiceRunning(channelId)` to `ForegroundSyncTickerModule`**,
implemented with `NotificationManager.getActiveNotifications()` matching our own channel id. Not
deprecated, returns only this app's notifications, and an FGS notification cannot outlive its
service — Android removes it when the service stops — so it is a faithful proxy rather than a guess.
Rejected `ActivityManager.getRunningServices()` filtered to `app.notifee.core.ForegroundService`: it
is deprecated since API 26 and would hardcode Notifee's internal class name into Kotlin, whereas the
channel id is a constant this repo owns.

**Rejected shortcut, recorded because it is the tempting one:** "just call `register()` blindly, it
is idempotent". It is not. A fresh adapter instance sees `isRunning() === false` for both the runner
and the ticker and starts a second runner. The ticker survives that only by accident — native
`startTicking()` calls `stopTicking()` first and the `PendingIntent` reuses one request code — and a
duplicate runner's cycles are serialized only by the pre-existing `withExclusiveSyncCycle` lease.
Two accidental protections, neither put there for this purpose, is luck rather than design.

Status: **done**, commit `25cd3df`. Route: delegated writer. 832 insertions, 2 deletions.

Shipped: native `isForegroundServiceRunning(channelId)`, the `native-foreground-service-presence.*`
seam, `foreground-service-watchdog.*` (pure `resolveForegroundServiceWatchdogDecision` plus the
effectful runner, which also self-heals the stale persisted flag on every branch where it has ground
truth), a new `'foreground_service_watchdog'` SQLite owner, and the wiring in `background-sync.task.ts`.

Evidence: genuine RED-first this time, across four vertical slices, each RED observed from a truly
absent implementation rather than reconstructed. MUTATE: the `isExempt` guard deleted from the
decision function, 2 failures (`Received: "restore"` on the pure case and its downstream effectful
case), restored from the index. Gate green on commit: 184 suites / 1405 tests.

**Second blocking defect, caught in review before the commit.** The watchdog was awaited in
`background-sync.task.ts` and bounded by a 20 s `withDeadline`. Both halves were wrong together:

- `adapter.register()` can hang forever on this path. The ordering note above
  `notifee.displayNotification` in the adapter states that code after that await may never run once
  the process is handed to Notifee's headless context.
- The deadline cannot end that hang. **Device-confirmed 2026-09-04:** JS timers stop running inside
  this headless `expo-background-task` cycle once any cycle fails to signal — RN's
  `JavaTimerManager` pauses `setTimeout` with the Activity, and `expo-task-manager`'s keep-alive
  re-registration only fires on the first event of `sEvents`, so one un-signalled cycle poisons every
  later cycle's timers. `adb logcat` showed zero `Started headless task ... to keep JS timers alive`
  across four cycles while 45 s and 90 s deadlines provably never fired during 600 s of silence.

Chained, an awaited hang would leave the task callback's `CompletableDeferred` uncompleted — exactly
the H06h loop `resolveBackgroundTaskOutcome` exists to break — and would then poison `sEvents` so JS
timers stayed dead for every later cycle. **This change would have reintroduced the bug the previous
release fixed, in a worse form.**

Fixed by not awaiting the watchdog: a structural guarantee that depends on no timer. The writer
verified it properly, reverting to `await` and confirming the new never-settling-promise test times
out against the old form, so the test is a real regression guard rather than a decoration. The
deadline constant stays, now documented as ineffective on this path and real only in a foreground
context, carrying an explicit warning against answering a future background hang with another
`setTimeout` — every JS-level bound in this repo dies simultaneously there; only native bounds fire.

### T5 — Correct the cadence premise and surface the state

Fix the nine-minute comment. Add the exemption state to the adapter status and a Settings row so the
maintainer can see, on device, whether the app is exempt. Extend the CI manifest guard in
`.github/workflows/release.yml` so the new permission cannot silently vanish the way
`withAndroidForegroundSync` failing would.

Status: **done**, commit `40ffcea`. Route: delegated writer, finished by the parent after the
writer hit its session limit mid-review.

Shipped: the nine-minute correction in both Kotlin comments, `isBatteryOptimizationExempt` through
`SyncExecutionStatus` and its two builders plus the facade's fallback and merge helpers, the Settings
action row and its own facade hook, the CI guard extended to six permissions plus `TickAlarmReceiver`,
and `stryker.dlinter.json` grown from one mutation surface to three.

**No database migration needed, and that was checked rather than assumed.** The field never enters
the persisted `sync_runtime_status` pipeline — the Settings row reads it through its own hook
straight from the T1 seam, bypassing `buildSyncExecutionStatusPatch`. This is what keeps the release
a minor bump.

**Defect fixed in review: the row could not survive the trip to the system dialog.** As delivered it
re-read `isExempt()` only immediately after `requestExemption()` — which launches the dialog and
takes the user out of the app, so that read still saw the pre-decision state. The user would grant
the exemption, come back, and the one screen reporting the keystone mechanism would still say "not
exempt", reading as a broken feature. Fixed with an `AppState` listener that re-reads on return to
`active` only; `background` and `inactive` cannot have changed the grant, and re-reading there would
churn state on every app switch. RED-first, and the `active`-only guard survives its own mutation.

**Rejected: the line-golfed test file.** Fitting the new assertions under the 500-line cap had cost a
five-line rationale comment (why the `react-native-notify-kit` mock mirrors the manifest sentinel),
several blank separators, and two collapsed object literals — landing at 499 of 500. That trade loses
information and leaves the next person one line of headroom. Restored, and the file split into
registration/status shape (333 lines) and cycle execution/teardown (355 lines) instead.

**Lint policy tension surfaced, deliberately not settled here.** The gate lints whole staged files,
so the touched Settings `.tsx` files had to answer for three pre-existing `react-doctor` findings.
Two were genuinely fixable and were fixed: `toneColors` moved into the hook as memoized derived state
(it was handing the sync card a new object identity every render, and it belongs there under the
dumb-`.tsx` rule anyway), and the error banner and card header became their own presentational
components. The remaining `jsx-max-depth` findings are **not** fixable by refactoring: the rule's
limit of 2 sits below the minimum nesting of the HeroUI Native compound components this project
mandates — `Chip > Chip.Label` is already at the limit before any layout wrapper, and
`HeroAlert > HeroAlert.Content > HeroAlert.Title` is the library's documented shape. Disabled per
file with that reason recorded. **This is a rule-versus-library mismatch that belongs in lint policy,
not in per-file suppressions, and it is the one open question this feature leaves behind.**

### T6 — Release 1.5.0

Minor bump (new feature, backward compatible, no local database migration): `1.4.1` → `1.5.0` in both
`app.json` `expo.version` and `package.json` `version`. Promote `## [Unreleased]` in `CHANGELOG.md`,
append the rationale with `node scripts/log-lesson.mjs`, merge to `main`, tag `v1.5.0`.

**Pushing `main` and the tag is outward-facing and irreversible.** Confirm with the maintainer before
the push, every time.

Status: not started.

## Progress

Nothing implemented yet. Next step: finish the code map, then T1.
