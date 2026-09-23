# native-foreground-sync-service

Feature: move the Android background-sync loop out of JS entirely. A Kotlin-owned foreground service,
restarted by the tick alarm, runs the native sync engine on each tick behind a native bridge-presence
gate. JS keeps the UI only.

Status: planning. Branch `fix/native-foreground-sync-service`, cut from `dev` at `ac18acb`.

Delivery strategy: `single-pr` (same reasoning as `background-service-multiday-survival.md`: no PR
process, local merge to `main`; the work-unit commits carry the review burden). The maintainer authorized
work-unit commits without per-commit confirmation (2026-09-23), after validation and diff review;
push, merge and release still need confirmation.

TDD: enabled. Source: user `CLAUDE.md` (Strict TDD) and project `AGENTS.md` (RED → GREEN → MUTATE →
REFACTOR). Runner: `bun run test` (`jest --maxWorkers=4`), focused `bunx jest <path>`. Real gate:
`npx lefthook run pre-commit`. Kotlin has **no unit-test harness** in this repo and is verified by the
Gradle compile inside `docker-compose.eas.yml`; that build needs Docker Desktop running (not running
at planning time — a blocker for verifying T1–T4, not for writing them).

RDD: off (global). Review assessment per commit is not run.

## Why

Device evidence of 2026-09-23 on the installed `1.5.0` (full entry in
`docs/mobile-background-sync-investigation-log.md`, "2026-09-23 (release 1.5.0 installed)"):

- A routine **Android System WebView auto-update** killed the process (`reason=16 PACKAGE UPDATED …
  stop com.google.android.webview due to installPackageLI`); the unexplained 2026-09-22 death has the
  same signature. It happens roughly daily and the app cannot prevent it.
- The native links of 1.5.0 worked: the exemption is granted, the manifest `TickAlarmReceiver`
  revived the process a minute later.
- Every JS link failed: the FGS was never restored, eleven consecutive `expo-background-task` runs
  were cancelled at 600 s, zero JS and zero engine log lines, the JS thread frozen (0.88 s CPU in
  3 h), four operations stuck, and the per-tick wake lock held until the platform disabled it.

Every link that worked is native; every link that failed is JS in a process with no Activity. So the
background path must not need JS at all — the Syncthing shape recorded on 2026-09-19.

## Goal

After the process dies for any reason other than a user force-stop, the next tick alarm brings the
foreground service back and runs a native sync attempt, with the app never opened. With the bridge
up, pending operations leave the device within one tick interval of the service coming back.

## Non-goals

- No change to the sync protocol, the engine's cycle, its lease or its 30 s native watchdog.
- No change to the tick interval (`60_000`) or the `specialUse` type.
- Notifee is not removed from the project: it stays for any non-FGS notification use.
- Not diagnosing why headless JS freezes. The design removes JS from the path; the question stays
  open in the log.

## Decisions

- **Kotlin owns the service outright.** This reverses the T2+T3 decision of
  `background-service-multiday-survival.md` ("the receiver does not restore the FGS"). That decision
  was right while Notifee owned the service; the fix is to move ownership, not to add a second owner.
  Notifee's `ForegroundService` stops being started for sync.
- **`START_STICKY`.** Notifee's service returned `START_NOT_STICKY` (`startCommandResult=2`, measured
  2026-09-20). Whether a `PACKAGE UPDATED` kill restarts a sticky service is **not measured**; the tick
  alarm is the guaranteed path and stickiness is a bonus, not a premise.
- **The receiver starts the service; the service runs the attempt.** The receiver stays tiny: read
  persisted `TickingState`, re-arm, `startForegroundService`. Background FGS start is legal because
  the app is on the user power allowlist (verified 2026-09-23). If the start is refused
  (`ForegroundServiceStartNotAllowedException`, e.g. exemption revoked), the receiver logs and keeps
  the alarm armed — degraded, never crashing.
- **The engine is callable from a plain `Context`.** `SyncEngineModule.runOnce` currently refuses
  without `appContext.reactContext` although it only uses `filesDir`. The attempt logic moves to a
  plain Kotlin entry point that the module and the service both call; one engine, two callers.
- **Native presence gate before every native attempt (closes T14 for the native path).** `GET
  /api/status` against `bridge_config` from SQLite, ~1.5 s budget, same contract as the JS
  `probeBridgePresence`. Absent bridge = no claim, no journal write beyond what the JS gate does today.
- **The native path gets a Kotlin test harness (maintainer decision, 2026-09-23).** The repo had
  none; that was a gap, not a constraint. JUnit 4 + Robolectric in `modules/sync-engine` (and in
  `foreground-sync-ticker` when T4 lands), run on the host with Gradle. The presence probe is tested
  against a real local `com.sun.net.httpserver.HttpServer`. T1/T2 tests are reconstructed after the
  fact and proven by mutation; T3 onward is RED-first.
- **Scope of tests: only what this feature adds (maintainer, 2026-09-23).** Pre-existing Kotlin
  behaviour is test debt for a **separate session**; see "Kotlin test debt — out of scope" below.
  Tests here cover T1–T6 behaviour only.

## Kotlin test debt — out of scope, owned by a separate session

**Baseline.** Every Kotlin line that existed on `dev` at `ac18acb` (the branch point) had zero tests:
the repo had no Kotlin harness at all. This feature creates the harness (JUnit 4 + Robolectric in
`modules/sync-engine`, and in `foreground-sync-ticker` from T4) and uses it only for new behaviour. The
debt session reuses the same harness and the same host command; it needs no new infrastructure.

**The rule that splits a file.** Behaviour this feature *adds or changes* is tested here. Behaviour
that existed at `ac18acb` and is only *moved* or *called* is debt, even when it now lives in a new
file. Behaviour this feature *retires* is neither: deleted code gets no tests.

**In this feature (not debt):**

| File | Tested here |
|---|---|
| `SyncEngineBridgePresence.kt` | all of it (new) |
| `SyncEngineHttp.kt` | `get` only (new) |
| `SyncEngineRunner.kt` | the presence gate, context-only entry, serialization of callers (new) |
| `SyncEngineModule.kt` | nothing in Kotlin: a thin adapter, its JS contract is covered by Jest |
| T3 service, T4 receiver/scheduler changes, T6 status writer | all new behaviour, RED-first |

**Debt, by priority** (line counts at time of writing; priority = consequence of a silent bug × how
cheap the test is):

| P | File(s) | Lines | Why this priority | Harness |
|---|---|---|---|---|
| 1 | `SyncCycleLease.kt` + fence use in `SyncEngineCycle.kt` | 112 + part | Correctness of concurrent attempts; the fence wiring defect of 2026-09-21 was caught only by reading | Robolectric SQLite |
| 1 | `ReconcileResponseParser.kt` | 317 | Pure parsing of bridge output; presence-vs-truthiness rules for OCC tokens; cheapest to test | plain JUnit |
| 2 | `SyncEngineResponseApplier.kt` | 103 | Writes the bridge's answer into the app DB inside one transaction | Robolectric SQLite |
| 2 | `SyncEngineCycle.kt` (the attempt itself, and the moved attempt body in `SyncEngineRunner.kt`: watchdog, abandon, crash mapping) | 496 + moved part | The whole attempt; largest file, highest blast radius, most expensive to set up | Robolectric + local `HttpServer` |
| 2 | `SyncEngineRecovery.kt` | 124 | Compensation of unfinished attempts; wrong here = stuck or double-applied operations | Robolectric SQLite |
| 3 | `ReconcileRequestBody.kt`, `ReconcileConfirmation.kt` | 125 + 64 | Request shaping and confirmation pass; mostly pure | plain JUnit / SQLite |
| 3 | `SyncEngineJournal.kt` | 171 | Journal append/read-back | Robolectric SQLite |
| 3 | `OperationLogPruner.kt` | 96 | Retention prune; ported statement-for-statement from JS | Robolectric SQLite |
| 3 | `SyncEngineDatabases.kt` | 209 | Constants and openers; tested indirectly by everything above | — |
| 4 | `SyncEngineHttp.postJson` | part | Thin transport; covered by the cycle tests against a local `HttpServer` | — |
| ? | `modules/sync-journal/.../SyncJournalModule.kt` | 239 | Second writer of `sync-journal.db` (T5 of `mobile-sync-native-engine`, unmerged). **Decide retire-or-unify before testing it**; testing a writer about to be deleted is waste | — |

**Explicitly not debt:**

- The `foreground-sync-ticker` behaviour that T4 retires (`onTick` dispatch to JS, the per-tick JS
  wake lock). Retired code gets no tests.
- The battery-exemption and `isForegroundServiceRunning` functions of `ForegroundSyncTickerModule.kt`:
  platform one-liners already covered at the JS seam; revisit only if T5 changes them.
- JS test debt of any kind: this section is Kotlin only.

**Exit criterion for the debt session.** Every P1 and P2 row has tests that fail when the guarded
behaviour is removed (mutation-proven, same method as this feature), run by the same host Gradle
command; P3 is best effort; the `SyncJournalModule` row is closed by a decision, not by tests.
- **Module placement:** the service lives in `modules/sync-engine` (it owns the engine and the
  databases); the tick alarm stays in `foreground-sync-ticker`. The receiver starts the service by
  class name through an explicit intent, so the two Gradle modules stay independent.

## Tasks

| ID | Task | Route |
|---|---|---|
| T1 | Engine entry point callable from a plain `Context`; `SyncEngineModule` delegates to it. No behaviour change. | delegated writer |
| T2 | Native bridge-presence probe gating the native attempt (T14 native half). | delegated writer (with T1 if small) |
| T3 | `SyncForegroundService` (Kotlin, `specialUse`, `START_STICKY`, own ongoing notification + channel, wake lock per attempt, one attempt per start command, serialized). Declared through `plugins/withAndroidForegroundSync.js`; plugin test + CI manifest guard updated. | delegated writer |
| T4 | `TickAlarmReceiver` starts the service on each tick while ticking; module `start()/stop()` start/stop the service and the alarm together; `onTick`→JS dispatch and the per-tick JS wake lock retired. | delegated writer |
| T5 | JS switch: FGS execution mode starts/stops the native service through the module seam; retire Notifee FGS start, the headless watchdog and the JS runner/ticker wiring on this path; `expo-background-task` stops being a sync path in FGS mode. Tests updated. | delegated writer |
| T6 | Native status projection into `sync_runtime_status` (T13) so Settings is not frozen. | delegated writer — may be split out if T1–T5 exceed budget |
| T7 | Device acceptance on the tablet (see Acceptance). | parent, on device |
| T8 | Release (minor bump), with maintainer confirmation before any push. | parent |

Checklist:

- [x] T1 (`db66a6f`)
- [x] T2 (`db66a6f`)
- [x] T3
- [x] T4
- [x] T5
- [ ] T6
- [ ] T7
- [ ] T8

## Acceptance (T7, on device)

1. App opened once, then closed: `dumpsys activity services` shows our service class, `isForeground=true
   types=0x40000000`, notification posted.
2. Process death without force-stop (next routine WebView/Play update, or an equivalent kill the
   platform allows from shell): within one tick interval, `am_proc_start … TickAlarmReceiver` then
   `am_foreground_service_start` for our class, **without opening the app**.
3. With the bridge up and pending operations: `SyncEngine` / `SyncEngineCycle` lines and the
   operations `synced` within one interval of step 2.
4. With the bridge down: presence refused, no claim, attempt < 2 s.
5. 24 h: zero `Client timed out … SystemJobService`; `ForegroundSyncTicker:ticking` never reaches the
   platform's `nocached` disable; stand-by bucket not `45`.

## Delivery forecast

~600–900 authored lines (Kotlin service + probe + entry point ~350, plugin/CI/tests ~150, JS
retirement and seam changes net ~200–400). Over the ~400 heuristic; under `single-pr` that means each
work-unit commit must stand alone.

## Kotlin verification without Docker

The full EAS build in Docker is too slow to run per task (maintainer constraint, 2026-09-23: under
5 minutes or not per task). Host-side instead: `npx expo prebuild -p android --no-install` once
(22.7 s; `package.json` unchanged; `/android/` excluded locally through `.git/info/exclude`, never
committed), then from `android/`: `./gradlew :sync-engine:compileReleaseKotlin
:foreground-sync-ticker:compileReleaseKotlin --console=plain`. First run, cold: **47 s**, host JDK 21
and the local Android SDK. The Docker APK build is kept for the device acceptance (T7) only. Re-run
prebuild whenever `plugins/withAndroidForegroundSync.js` changes.

## Progress

### T1 + T2 — done, committed `db66a6f`

Route: delegated writer (writer trigger: 4 Kotlin files). Shipped:

- `SyncEngineRunner.kt` (new): process-wide singleton owning the single worker executor, the watchdog,
  the lazily opened app database and journal (init under `synchronized`), and the whole attempt, moved
  verbatim from the module. API: `runOnce(context, triggerSource, cycleId, startMs, requirePresence =
  false, onResult)`. `cycleId`/`startMs` stay minted by the caller so the module's `MissingReactContext`
  refusal still logs the identical `runOnce invoked` line.
- `SyncEngineModule.kt`: thin adapter; resolves `appContext.reactContext?.applicationContext`; JS-visible
  payload and log lines unchanged.
- `SyncEngineBridgePresence.kt` (new) + `SyncEngineHttp.get`: `GET http://{ip}:{port}/api/status`,
  `Authorization: Bearer {token}` only, 1 500 ms. Any completed HTTP exchange is presence; only a
  transport failure is absence. Mirrors `probeBridgePresence`
  (`notifee-foreground-service-adapter.helpers.ts:94-116`), `ATTEMPT_PROBE_DEADLINE_MS`
  (`attempt-policy.constants.ts:37`) and `bridge-url.helpers.ts:33-64`. Refused presence returns
  `not_applicable` / `BridgePresenceRefused` / stage `idle`, with no lease and no journal write;
  `not_applicable` is already in JS's closed `NATIVE_OUTCOMES`. The gate is reachable only with
  `requirePresence = true`, i.e. from T3's service; the JS path is unchanged.

Evidence: `bunx jest tests/features/sync` 84 suites / 678 tests passed; `bun run typecheck` passed;
Kotlin compile `BUILD SUCCESSFUL` (47 s, no warnings in either module).

**Kotlin harness and T1/T2 tests (added before the commit, maintainer request).** Route: delegated
writer. `modules/sync-engine/android/build.gradle` gains JUnit 4.13.2, Robolectric 4.14.1 and
`androidx.test:core` 1.6.1 as `testImplementation`, `unitTests { includeAndroidResources = true;
returnDefaultValues = true }`, and, for `*UnitTest` Kotlin compile tasks only, `noJdk = false` +
`-Xadd-modules=jdk.httpserver` (AGP compiles unit tests against `android.jar` alone, which lacks
`com.sun.net.httpserver`; release compile verified unaffected). `robolectric.properties` pins
`sdk=35`. Command: from `android/`, `./gradlew :sync-engine:testDebugUnitTest --console=plain` —
11.7 s module-clean, 5.1 s warm, 23 s with `--rerun-tasks` (parent spot check).

- `SyncEngineBridgePresenceTest` (9, plain JUnit, real local `HttpServer`): 200 present with exact
  `GET /api/status`, `Authorization: Bearer` and no `Content-Type`; 401 present; closed port absent;
  slow server absent within the bound; missing config / blank ip / blank port / blank token absent
  with zero requests; `deviceId` not required.
- `SyncEngineRunnerTest` (4, Robolectric): gated refusal with no config (no journal rows); gated
  refusal against an unreachable port, bounded; the ungated path reaches the cycle's own no-config
  outcome; two back-to-back attempts never interleave (journal row pairs per cycle id).
- Production seams, behaviour-neutral: `SyncEngineBridgePresence.probe(config)` (the `appDb`
  overload delegates to it) and `internal SyncEngineRunner.resetForTest()`.
- RED was reconstructed, not first (the code preceded the harness). Mutation-proven: removing the
  gate → `expected:<BridgePresenceRefused> but was:<null>`; non-2xx as absence → the 401 test fails;
  dropping the blank-token check → the blank-token test fails. All restored.

**Harness limit found, matters for T3:** Robolectric 4.14.1's bundled SQLite rejects the lease's
`INSERT … ON CONFLICT DO UPDATE` (`near "ON": syntax error` — UPSERT needs SQLite ≥ 3.24). So no test
here reaches a successful lease claim. Candidate fix, **not yet verified**: Robolectric's native SQLite
mode (`@SQLiteMode(SQLiteMode.Mode.NATIVE)`). Must be tried before any T3 test needs a claimed attempt.

**Known deviation, accepted for now:** the 1 500 ms is applied to connect and read separately, so a
bridge that accepts the connection and never answers can cost up to 3 s. The JS probe bounds the total
at 1.5 s. With the PC off (the real absent case) the connect fails or times out and the read never
starts, so the measured cost should stay within 1.5 s. T7 measures it.

**Constraints for T3, found in the T1+T2 diff review:**

- `SyncEngineRunner.runOnce` runs the presence probe on the **caller's thread**. Called from
  `onStartCommand` (main thread) it throws `NetworkOnMainThreadException`, which the probe's
  `catch (Throwable)` reports as absence: every attempt refused, silently. Move the probe onto the
  runner's `worker` (inside the budget) before the service calls it.
- `lastState` is one process-wide reference and the watchdog is armed at **enqueue**, not at
  execution. With two callers (JS + service) a queued attempt can be abandoned while still waiting
  behind the running one, and the reset of `lastState` clobbers the running attempt's stage.
  Pre-existing shape, now reachable: make both per attempt and arm the budget when the worker starts.

### T3 — done

Route: delegated writer (writer trigger: service + runner + plugin + CI guard + tests).

- `SyncEngineRunner`: the presence probe and the cycle run only on `worker`; stage is per attempt.
  The watchdog stays armed at **enqueue** (the budget covers queue wait + probe + cycle), and a
  worker that picks up an attempt already abandoned while queued runs neither probe nor cycle. Every
  settlement path goes through one `settled` compare-and-set. (A first draft armed the watchdog at
  worker start, following the constraint as originally worded; the parent review rejected it: a
  parked worker would leave queued attempts unresolved forever and pin the service's in-flight flag.)
- `SyncForegroundService` (new): `specialUse`, `START_STICKY`, channel `autoreas-sync-foreground-native`
  with the Notifee copy, one attempt per start command with `requirePresence = true` and
  `triggerSource = "native_fgs_tick"`, coalesced while one is in flight, partial wake lock per attempt
  (35 s safety timeout) released on every path. Stable cross-module contract for T4:
  `expo.modules.syncengine.SyncForegroundService`. It never calls `stopSelf()`.
- Manifest through `plugins/withAndroidForegroundSync.js`; plugin test and the `release.yml` manifest
  guard require the new service. Notifee's declaration untouched (T5).

Evidence: Kotlin 21 tests green (9 presence, 7 runner, 5 service); both release compiles
`BUILD SUCCESSFUL`; plugin Jest 7/7; lefthook pre-commit pass (185 suites / 1417 tests). RED
observed against the rejected draft; mutations: removing the queued-skip guard runs the zombie cycle
(`expected:<[abandoned]> but was:<[abandoned, checked, not_applicable]>`); removing coalescing, wake
lock release, in-flight reset or `startForeground` each fails its test.

**Harness finding:** Robolectric's PAUSED looper uses a virtual clock; `postDelayed` on the
watchdog's background looper fires only with `ShadowSystemClock.advanceBy(...)` plus
`shadowOf(looper).idleFor(...)`. Real sleeps never fire it. Applies to any future test of the
`abandoned` path (Kotlin test debt).

### T4 — done

Route: delegated writer. `TickAlarmReceiver` re-arms first, then starts
`expo.modules.syncengine.SyncForegroundService` by explicit class name (no Gradle dependency);
any start failure is logged and the alarm stays armed. Module `start()`/`stop()` delegate to
`startSyncTicking`/`stopSyncTicking` (persist state + alarm + service together). The `onTick` → JS
dispatch, `activeInstance` and the per-tick JS wake lock are retired; `Events("onTick")` and
`notifyCycleComplete()` stay declared but inert until T5 drops their JS consumers. Harness added to
`foreground-sync-ticker` (11 tests). Two false-negative mutations were caught and fixed in the tests
(an outer catch masking the bridge's own catch; JVM name mangling of `internal` methods).

Evidence: both Gradle unit-test modules and both release compiles `BUILD SUCCESSFUL`; typecheck
clean; lefthook pre-commit 185 suites / 1417 tests.

**For T5:** drop the `onTick` listener and `notifyCycleComplete()` calls
(`native-foreground-sync-ticker.helpers.ts`) and their types; the FGS-mode JS runner no longer
receives ticks; `foreground-service-watchdog.helpers.ts` checks Notifee's channel with
`isForegroundServiceRunning`, but the live FGS now posts on `autoreas-sync-foreground-native`.
Module `OnCreate` re-arms the alarm but does not start the service; opening the app restores it only
through JS `start()` (T5) or the next tick.

### T5 — done

Route: delegated writer. New `native-foreground-sync-adapter` replaces the Notifee adapter as the
FGS execution strategy: `register()` requests notification permission, then `ticker.start(60_000)`
(native persists state, arms the alarm, starts the service); `unregister()` calls `ticker.stop()`;
app open calls `register()` again, which restores a dead service. `getStatus()` checks presence on
`autoreas-sync-foreground-native`. `runBackgroundSyncCycle()` returns `no_op` before touching SQLite
while the ticker reports ticking (the module restores `isTicking` from persisted state in `OnCreate`,
so this holds in a revived headless process). Retired: the Notifee FGS adapter, the JS foreground
runner, `attempt-policy`, the headless watchdog, the `onTick` event and `notifyCycleComplete`
(JS and Kotlin). Stryker surface moved from the deleted watchdog to the new adapter's helpers.

Evidence: `bun run test` 180 suites / 1365 tests; typecheck clean; react-doctor 100/100; both
Gradle test modules and release compiles `BUILD SUCCESSFUL`; lefthook pre-commit pass with staged
mutation score 100 (three survivors found by Stryker were closed with tests).

Follow-ups (not in scope): Notifee's `app.notifee.core.ForegroundService` manifest declaration and
`FOREGROUND_SERVICE_DATA_SYNC` look dead now; the `SyncSQLiteOwner` variants `foreground_service` /
`foreground_service_watchdog` are unreachable. Known behaviour for T7: `startTicking` stops then
restarts the service, so each app open recreates it (notification may flicker).

**For T6:** nothing writes `sync_runtime_status` for FGS-mode attempts any more; Settings shows the
service presence live, but `last_attempt_at` / `last_success_at` / `last_trigger_source` go stale.

Next: T6.
