# ODD — mobile sync: native engine and single-owner writes

**Status:** Open. Design decisions taken 2026-09-20. T1 done. T2 and T7 are implemented, committed
and **accepted on device (2026-09-20 23:13)**: with the bridge off, operation id 19 (created
23:05:04) was delivered by the native engine in background with the app closed — journal
`idle→checked→claimed→sent→applied→closed`, the operation reached `synced`, the cursor advanced
2352 → 2358, and background attempts cost 13–26 ms afterwards. The build carried `4654779` (module
registration — the root cause found 2026-09-20: the local modules declared `modulesClassNames` where
SDK 55 reads `modules`, so nothing was registered at runtime and every native seam was a silent
no-op) and `3e6e10b` (start ordering). T4 is implemented and committed (`23e22f3`:
`SyncEngineRecovery.sweep(cycleId)` called from `SyncEngineCycle.runCycle` right after the lease
claim) — its device evidence is still open. **Implemented on 2026-09-21 and committed on `dev` —
`2b70829` (empty-outbox pull), `739fa8a` (watchdog budget clock), `0db36e5` (ticker wake lock
scoped to the cycle) and `9f2a3fa` (the instrument) — not yet accepted on device** (all three
verified by the grouped Kotlin compile — `BUILD SUCCESSFUL` for
`:sync-engine` and `:foreground-sync-ticker` — plus 174 suites / 1288 tests green and `tsc --noEmit`
clean): T11 (the wake lock is now scoped to the cycle, with `AlarmManager` `ELAPSED_REALTIME_WAKEUP`
scheduling), the empty-outbox pull, and the watchdog budget moved onto
`SystemClock.elapsedRealtime`. Defects found on 2026-09-21 and since closed on `dev`: no backoff
and no presence policy (6 attempts/min of 30–65 s each with the bridge down, 20 connection failures
in 3 minutes, and the runner discarding the cycle promise) is closed by `6b10bcd` (T6); the `settled`
interlock that was shared across attempts — letting two overlapping `runOnce` invocations strand one
promise unresolved — is closed by `671d38b`; and the temporary `[fgs]` diagnostic is removed by
`6b10bcd` (T10 is done). Platform consequence, decided on 2026-09-21:
`SCHEDULE_EXACT_ALARM` is denied by default on Android 14+ for apps targeting 33+
(`targetSdkVersion: 35`), so the ticker requests no exact-alarm permission at all and always
schedules the inexact `setAndAllowWhileIdle`, whose cadence floor is about one alarm per minute
(longer in Doze). The maintainer accepts that floor and prefers avoiding the revoked-permission
scenario; the 15 s `FOREGROUND_SYNC_INTERVAL_MS` is therefore not a cadence the platform honours,
and T6 owns the honest value — to be measured on device, not chosen. The app's stand-by bucket now
reads `10 EXEMPTED` (was `45` RESTRICTED). Nothing is pushed — `dev` has no `origin/dev` remote ref;
delivery is the maintainer's decision.

**2026-09-21, autonomous run: T6 and the per-attempt interlock are committed (`671d38b`, `6b10bcd`),
the build carrying them is installed on the tablet, and the device acceptance is BLOCKED.** The
tablet sat at the credential keyguard for the whole window, and the app cannot complete its JS
startup while locked: with the keyguard showing, neither the new build nor the previous known-good
build opens its SQLite store, registers the foreground service, or schedules a tick alarm (measured:
`files/SQLite/autoreas.db` mtime unchanged, `dumpsys alarm` reporting zero alarms for the package,
`dumpsys jobscheduler` reporting no registered job). The credential is unknown and was deliberately
neither cleared nor guessed; the device settings this run touched were restored. Baseline measured
before the install, with the bridge down and the pre-T6 build: **125 failed attempts, one every 10
seconds**, each paying the full 10 s connect timeout — the exact defect T6 closes. The three real
pending operations (ids 20, 21, 22) remain undelivered.

**Supersedes:** `odd/tasks/background-sync-native-bound.md` (T1/T2/T4/T5/T7/T8/T9 carry over with new
outcomes), `odd/tasks/background-sync-handoff-bound.md` (retired), `odd/tasks/sync-cycle-checkpoint-wiring.md`
(closed by the first commit of this feature).
**Architecture:** `docs/mobile-sync-architecture.md` — the decisions in its §7 are the source of scope here.
**Evidence base:** `docs/mobile-background-sync-investigation-log.md`.

## Why

With the app closed, the sync cycle parks forever inside a write and nothing closes: **41 consecutive
`never_closed` attempts**, each ended by the platform at ~600 s, with the app pushed into Android's
`RESTRICTED` stand-by bucket. The device measurements and the pattern diagnosis are in the architecture
document (§3, §4); this document is the execution plan that follows from them.

Four decisions frame every task below (architecture doc §7):

1. **The engine moves native (Kotlin).** No JS timer remains on the sync path.
2. **No resident service by default.** The bridge's availability window is a profile, not a constant, so
   the app must be cheap while the bridge is absent without knowing the schedule.
3. **Full ownership target:** journal in its own file, sync store separated, and the process-wide
   file-keyed write door replaced by a single-writer actor per store with lease and fencing.
4. **Liveness is a native watchdog plus journal recovery.** Restoring the `HeadlessJsTask` registration
   is retired, because nothing on the sync path depends on JS timers any more.

## Goal

The app delivers pending operations within the first hour the bridge is reachable again — after any
absence, however long — without the user opening the app, and no attempt can occupy a job silently.

## Non-goals

- Rewriting the foreground apply logic. In `staged` mode the background cycle never writes `animes`;
  the foreground drain keeps that job.
- Changing the bridge protocol or the outbox semantics.
- Touching the UI beyond the status surface the journal feeds.

## Tasks

### T1 — ADR amendment for the native boundary
- Surface: `docs/adr/` (new ADR or an amendment to 007), `docs/mobile-sync-architecture.md`.
- Requirement: record that a background engine may be native, what it owns (transport, claim, staging,
  cursor, prune, journal) and what stays in TS (domain apply on the foreground). ADR 007 decision 3
  (policy separated from mechanism) is preserved and becomes the seam the policy lives on.
- Evidence: the ADR text, and the architecture doc pointing at it.

### T2 — S1: native journal with recoverable attempt state
- Surface: the native module that will host the engine, plus its manifest/schema.
- Requirement: append-only journal in its **own file and connection**, one row per transition
  (`cycle_id`, `from`, `to`, `at`, `attempt_seq`, `reason`), for the states in architecture doc §6.2.
  No behaviour change to sync in this slice.
- Evidence: focused tests for the journal store; on device, a parked attempt leaves a readable state.

### T3 — S2: native watchdog and the `abandoned` outcome
- Surface: the native module.
- Requirement: a bound that lives outside the guarded work and can abandon it, plus an abandon record a
  parked store write cannot skip. The OS job stop remains the outer backstop.
- Evidence: focused tests; on device, zero `Client timed out while executing` stops in 24 h and the
  parked attempt ends as `abandoned`.

### T4 — S3: recovery sweep
- Surface: the native scheduler/policy component.
- Requirement: on any trigger, reclaim a stale state — release the lease, return the batch to `pending`,
  mark `abandoned`. Invariant 2 of architecture doc §6.2 is the acceptance.
- Evidence: the two orphan `processing` rows from the live device return to `pending` with no user
  action; the stale `sync_cycle_lock` lease is released.

### T5 — S4: single-writer actor per store, and the sync store separated
- Surface: the native module; the TS store boundary.
- Requirement: one writer per store with a recorded owner, a lease with expiry and fencing;
  the sync-critical state leaves the UI's store so a parked UI write cannot delay an attempt, or the
  reverse. The file-keyed door stops being the app's global arbiter.
- Evidence: a parked UI write does not delay an attempt (device test), and a reclaimed lease rejects the
  previous owner's writes (focused test).

### T6 — S5: presence gate and attempt policy
- Surface: the native policy component; the persisted presence fact.
- Requirement: presence is a persisted fact the background can read; no presence means no state entered
  and no write issued. Backoff with jitter is ours (the Expo background API exposes only an interval).
- Evidence: with the bridge absent, an attempt costs `< 2 s` and writes nothing, measured on device.

### T7 — S6: the native engine
- Surface: the native module.
- Requirement: read outbox → claim → HTTP → map the wire response → stage into
  `pending_remote_changes` → advance cursor → prune → journal. No `bridge_changes` apply to domain
  tables. In `staged` mode the background cycle DOES write `animes` through the OCC token path —
  `persistConfirmedAnimeTokens` and, per conflict outcome, `applyAnimeBridgeToken`, each a single
  `UPDATE animes SET bridge_modified_at = ?` on a column disjoint from the domain ones — so those
  token writes are part of this task's scope: the engine must own them under the cycle lease
  (perform, defer, or re-home them), never skip them.
- Evidence: the wire mapping is diffed against the captured bodies before the JS path is retired
  (architecture doc §10); on device, a closed app closes a cycle; on device, the engine's only
  `animes` write is the `bridge_modified_at` token update.

### T8 — S6b: retire the JS background scaffolding
- Surface: `src/features/sync/**`, `app.json`, `modules/foreground-sync-ticker`.
- Requirement: `expo-background-task`, the native ticker and the JS background bounds leave the sync
  path once T7 is observable.
- Evidence: the diff, and the acceptance metrics still holding afterwards.

### T9 — Acceptance on device
- Surface: none (measurement).
- Requirement: architecture doc §9, first row included: catch-up within the first hour of reachability
  without opening the app, for a long absence as well as a short one.
- Evidence: journal, outbox, `dumpsys jobscheduler`, `am get-standby-bucket`, recorded in the log either
  way — including the counter-case.

### T10 — Remove the temporary `[fgs]` foreground-sync diagnostic
- Surface: `src/features/sync/notifee-foreground-service-adapter/notifee-foreground-service-adapter.helpers.ts` (one `console.warn` line plus its marker comment), `tests/features/sync/notifee-foreground-service-adapter.test.ts` if a case references it.
- Requirement: delete the temporary `console.warn('[fgs] foreground sync work started')` diagnostic added in `register()` once the ticker is observed ticking on a device (`ForegroundSyncTicker:ticking` wake lock present in `dumpsys power`). Temporary markers without an owner are recurring debt in this project, so the removal is tracked as a task.
- Evidence: the device observation itself — the `dumpsys power` capture showing the `ForegroundSyncTicker:ticking` wake lock while the foreground service is up, recorded in the investigation log.

### T11 — Wake lock scoped to the cycle, with a suspend-proof tick schedule
- Surface: `modules/foreground-sync-ticker/` (Kotlin) and the JS contract that reports cycle
  completion back to it.
- Requirement: stop holding a `PARTIAL_WAKE_LOCK` for the whole foreground-service lifetime. The
  system tags that hold `LONG`, which makes it the most plausible trigger for the manufacturer
  sleeping the app. Acquire the lock when a tick is dispatched and release it when that cycle
  reports completion, so the tick source survives CPU suspension without a permanent hold. The
  schedule must accept a variable delay, because T6 supplies the interval policy afterwards.
- Coupled decision, recorded because it is not separable: `Handler.postDelayed` counts
  `SystemClock.uptimeMillis()`, which **stops advancing while the CPU is suspended** -- that is the
  exact reason the current code holds the lock for the whole lifetime. Releasing the lock during the
  wait therefore requires a schedule that fires while the device is idle (AlarmManager
  `setAndAllowWhileIdle`); keeping `postDelayed` and releasing the lock reintroduces the suspend gap
  this module exists to close. The alarm-based option is the only one that preserves the ≤1 h
  catch-up in the Acceptance section, so it is the one this task takes.
- Evidence: focused tests over the schedule and lock lifecycle; on device, `dumpsys power` shows
  `ForegroundSyncTicker:ticking` held only for the duration of a cycle while the interval between
  ticks still holds with the screen off. **Device evidence is deferred: the maintainer cannot test
  it until a later build.**

### T12 — A trigger that survives a process death or a reboot
- Surface: the native module (a `BOOT_COMPLETED` receiver and/or a periodic `AlarmManager` alarm) or
  the persisted WorkManager job; whichever is chosen must be able to start the foreground service
  without a live UI.
- Requirement: tonight's blocker exposed the gap. The foreground service and its tick alarm are both
  started from the JS UI, and while FGS mode is active the WorkManager worker is unregistered, so
  after a reboot or a force-stop nothing starts the engine until the user opens the app. The Goal
  promises delivery "after any absence, however long — without the user opening the app", and that
  promise currently holds only for a foreground service that is already alive. Decide between a
  boot-receiver plus a periodic alarm that starts the service natively, and keeping the WorkManager
  job registered as the reboot-safe trigger; both must respect the presence gate (T6) so an absent
  bridge stays cheap.
- Evidence: `dumpsys jobscheduler` showing no registered job for the package while FGS mode is
  active, the runtime status flag `is_background_task_registered=0`, and the earlier device observation
  that the app's attempts stop the moment it is force-stopped. Device verification of the fix is
  required and is open.

## Sequence

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. T2 before T3 is deliberate: if an attempt cannot report,
the next attempt's sweep must be able to recover it from durable state, and that requires the journal
first. T5 may run in parallel with T3/T4 only if the store split lands before T7.

## Acceptance

- No attempt ends without a terminal journal state (`closed`, `failed`, `abandoned`).
- `consecutive_unclosed_cycles` stays 0 for 24 h with the app closed.
- Zero JobScheduler `Client timed out` stops for the app, and the stand-by bucket is not `45`.
- A no-op attempt costs milliseconds with the bridge absent.

## Checks

- Focused: `npx jest <focused paths> --maxWorkers=4`
- Gate: `npx lefthook run pre-commit` with the files staged
- Types: `npx tsc --noEmit`
- Native: a rebuild is required for every Kotlin slice before T9 can observe anything

## Work units

One commit per task, Conventional Commits, tests and docs alongside the behaviour. Commits are prepared
and held until the maintainer confirms, per `AGENTS.md`.

## Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | done | `docs/adr/008-native-sync-engine-and-single-owner-writes.md` — accepted 2026-09-20; amends ADR 007 by keeping its decisions 1, 2, 3, 4 and 6 while changing the substrate and the ownership mechanism, records the device evidence that closed 007's own gate, and puts four invariants in force. |
| T2 | done — device acceptance verified 2026-09-20 | `sync-journal` local module, implemented and committed; confirmed in the binary by `npx expo-modules-autolinking search --platform android` (2026-09-20). Root cause of the earlier silence: the local modules declared `modulesClassNames` where Expo SDK 55 reads `modules`, so nothing was registered at runtime and `requireOptionalNativeModule` returned null for `SyncJournal` too (no journal file ever appeared); fixed in `4654779` (`expo-modules-autolinking resolve` now reports a classifier per module). **On device (2026-09-20 23:13): `files/sync-journal.db` written — operation id 19 (created 23:05:04 with the bridge off) traversed `idle→checked→claimed→sent→applied→closed` in background with the app closed, and the cursor advanced 2352 → 2358.** |
| T3 | implemented (budget clock), committed (`739fa8a`) — device acceptance open | Cause **confirmed from the Android clock semantics, not assumed**: `Handler.postDelayed` is delivered against `SystemClock.uptimeMillis()`, which does not advance while the CPU is suspended, so the 30 s budget was never exceeded in the watchdog's own clock and it never fired -- matching the measured 78 s of wall clock with no `abandoned` row. The budget is now an absolute deadline on `SystemClock.elapsedRealtime()`, re-checked when the callback is delivered; an unarmable watchdog refuses the attempt and traces the refusal as an `abandoned` journal row instead of running without a budget. Honest limit: user-space code cannot run while the CPU sleeps, so the guarantee is "fires at the first schedulable moment after 30 s of wall clock". Kotlin compile verified (`BUILD SUCCESSFUL`). **The `abandoned` outcome is still unobserved on device.** |
| T4 | implemented, committed (`23e22f3`) — device evidence open | `SyncEngineRecovery.sweep(cycleId)` is called from `SyncEngineCycle.runCycle` right after the lease claim. Ground truth for the sweep: 2 orphan rows in `processing`, `sync_cycle_lock` owner `headless_cycle` expired, `is_cycle_active = 1` (§3.5 of the architecture doc). **Neither recovery has been observed on device yet: the two orphan `processing` rows returning to `pending`, and the expired `sync_cycle_lock` lease being released, remain open.** |
| T5 | pending | |
| T6 | implemented, committed (`6b10bcd`); native interlock half `671d38b` — device acceptance open | Measured defect (device, 2026-09-21, pre-T6 build, bridge down): **125 failed attempts, one every 10 seconds**, each paying the full 10 s connect timeout — a 100 % duty cycle of failing attempts, with nothing stopping a tick from starting while the previous attempt was still timing out. The fix gates every tick on a `GET /api/status` probe (1500 ms budget; any HTTP answer counts as present), enforces one attempt in flight, and backs the cadence off across ticks (1x/2x/4x/8x of a 60 s base, capped at 15 minutes, ±20 % jitter, reset on first success), never lengthening the ladder for a 4xx. 47 focused tests cover the ladder, the jitter bounds, the reset, the refusal and the in-flight block. **The acceptance — "with the bridge absent, an attempt costs < 2 s and writes nothing" — is NOT measured: the device window was blocked; an earlier 4-minute observation of a flat journal was VOID because the app's sync runtime had not started at all.** |
| T7 | done — device acceptance verified 2026-09-20 | Engine implemented and committed; invocation provable (`cf71725`: `SyncEngine: runOnce invoked (...)` before anything else, completion line with outcome/stage/elapsed, once-per-runtime JS warning when the native module is missing), reachable from the active path (`e038901`), and registered at runtime (`4654779`). **On device (2026-09-20 23:13): with the bridge off, the native engine delivered operation id 19 (created 23:05:04) in background with the app closed — journal `idle→checked→claimed→sent→applied→closed`, the operation reached `synced`, cursor 2352 → 2358; background attempts cost 13–26 ms afterwards.** Remaining measured gap closed on 2026-09-21 (`2b70829`): the empty-backlog attempt now issues the reconcile request pull-only through the same parse/stage/cursor pipeline, and the response-apply step was extracted verbatim into `SyncEngineResponseApplier.kt` — verified byte-identical against the previous `applyResponseWrites` — so both attempt shapes share one writer. The pull-only journal reads `checked→sent→applied→closed` with no new state names, and the claimed path is unchanged. Kotlin compile verified (`BUILD SUCCESSFUL`); device evidence for the pull is open. |
| T8 | deferred, with reason | Two reasons, in order. (1) Its evidence is "the acceptance metrics still holding afterwards", and no acceptance metric could be measured in this run. (2) There is now a stronger reason to re-scope it: the runtime status reads `is_background_task_registered=0` and `dumpsys jobscheduler` shows **zero registered jobs for the package**, because the foreground-service mode unregisters the WorkManager worker (`background-sync.task.ts:57`). Since the foreground service is started by the JS UI, that leaves **no trigger at all after a reboot or a force-stop** until the user opens the app — so removing the WorkManager path before a non-UI trigger exists (T12) would break the Goal instead of simplifying the app. T8's text also lists "the native ticker" for removal, which is now the only FGS tick source, so the task needs a re-scope before it is implemented. |
| T9 | attempted 2026-09-21, blocked | The build carrying `671d38b` and `6b10bcd` was installed and verified on the tablet, and then nothing could be measured: the tablet remained at the credential keyguard, and the app cannot complete its JS startup while locked (evidence in the Status paragraph). Installing and launching the previous known-good build reproduced the identical stall, which isolates the cause to the lock rather than to this change. No metric of architecture-doc §9 was obtained — not the catch-up window, not the 24 h unclosed-cycle count, not the stand-by bucket — and the three real pending operations are still undelivered. |
| T10 | done | The temporary `console.warn('[fgs] foreground sync work started')` diagnostic is **removed** in `6b10bcd`, together with its marker comment. Its removal condition had been met (`ForegroundSyncTicker:ticking` was observed on device), and the ticker was restructured afterwards so the marker's assertion no longer described the code anyway. |
| T11 | implemented, committed (`0db36e5`) — device acceptance open | The lock is no longer held for the whole ticking lifetime: one reference is acquired per dispatched tick and released when JS reports the cycle settled through the new `notifyCycleComplete()` (a rejection settles too), with a 120 s `acquire(timeout)` safety net for a cycle that never reports back. Inter-tick scheduling moved from `Handler.postDelayed` to
`AlarmManager` `setAndAllowWhileIdle` with `ELAPSED_REALTIME_WAKEUP` (a clock that counts suspend
time) — deliberately inexact, so no exact-alarm permission is requested and the module manifest
declares none. Kotlin compile verified (`BUILD SUCCESSFUL`); 33 focused tests green, covering release-on-resolve, release-on-reject, and one release per dispatched tick. **Device verification deferred by the maintainer on 2026-09-21.** |
| T12 | pending — found 2026-09-21 | No path starts the sync engine unless the user has opened the app: the foreground service and its tick alarm are both started from JS, and the WorkManager fallback is unregistered while FGS mode is active (`is_background_task_registered=0`, no job in JobScheduler). After a reboot or a force-stop, the app therefore delivers nothing until it is opened, which is narrower than the Goal ("after any absence, however long — without the user opening the app"). The 2026-09-20 23:13 acceptance did not cover this case: the foreground service was already running. |

### Device acceptance checklist (run of 2026-09-20 23:13)

Until 2026-09-20 no attempt reached the engine, so none of these had ever been observed on device.
The run against the build carrying `4654779` and `3e6e10b` was the first. Outcome per item:

- [x] Ticker wake lock present — `ForegroundSyncTicker:ticking` observed on device, held for the
      whole ticking lifetime and tagged `LONG` by the system (the measurement that opened T11).
- [x] Engine invoked on device — the native engine executed the cycle end to end in background with
      the app closed: journal `idle→checked→claimed→sent→applied→closed`, operation id 19 reached
      `synced`, cursor 2352 → 2358. Observed through the engine's own journal transitions, the same
      runtime state the `SyncEngine: runOnce invoked` logcat line was written to correlate.
- [x] `files/sync-journal.db` created with transition rows — the transition chain above.
- [x] `last_attempt_at` fresh — background attempts ran after the sync, each costing 13–26 ms.
- [ ] **FAILED — the attempt was not bounded to 30 s.** The watchdog budget is armed with
      `Handler.postDelayed`, whose clock freezes while the CPU is suspended: 78 s of wall clock were
      measured against the 30 s budget, with no `abandoned` row.

Trigger constraints, one line each: the `expo-background-task` worker only executes its task with the
app in the background (a foreground run is skipped by the library's own guard and reschedules in
15 minutes); the service ticker runs with the app alive. Note also that a `production`-profile build
is not debuggable, so the device run must use the `lab` profile for `run-as` reads of the journal.
