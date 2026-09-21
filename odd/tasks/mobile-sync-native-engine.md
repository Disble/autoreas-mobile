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
claim) — its device evidence was verified on 2026-09-21, when the sweep reclaimed an abandoned
attempt. **Implemented on 2026-09-21 and committed on `dev` —
`2b70829` (empty-outbox pull), `739fa8a` (watchdog budget clock), `0db36e5` (ticker wake lock
scoped to the cycle) and `9f2a3fa` (the instrument) — since accepted on device on 2026-09-21, see the paragraph below** (all three
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
the build carrying them is installed on the tablet, and the device acceptance was ACHIEVED (T9) once
the tablet was unlocked.** The app sat in the background from 08:03:20 and the bridge came up at
08:06:44; at 08:17:59 the background service delivered the three real pending operations (ids 20, 21
and 22, created 00:48-01:45): the journal traversed `idle→checked→claimed→sent→applied→closed` with
a `sent→abandoned (recovered by later attempt …)` row reclaimed by the recovery sweep first, the
engine logged `outcome='closed' stage='closed' in 296ms`, `operation_log` reached `synced=22` with
nothing unsynced, and the cursor advanced 2359 → 2362 on both sides. The bridge captured a pull-only
`reconcile` with `pending_operations: []` (the `2b70829` behaviour) and a `GET /api/status` 200 (the
T6 probe). The instrument reported **11/11 PASS**, and the ticker wake lock was never held across 100 s
of idle sampling. Earlier in the same window the tablet spent a stretch at the credential keyguard,
where the app cannot complete its JS startup; the credential was deliberately neither cleared nor
guessed and the device settings touched were restored.

**2026-09-21, 24 h measurement window OPEN — lab build `build-1790006856748`.** The build was made at 11:07 from a tree verified clean at `fc39e7a` and installed at 11:11 (device read-back: `DEBUGGABLE`, `versionCode=9`); it carries `823d412`, the fix that makes both terminal `sync_runtime_status` patch builders write `isCycleActive: false`. The JS half of that claim is NOT directly readable from the artifact: the install carries a **Hermes bytecode** bundle (`assets/index.android.bundle`, magic `c61fbc03`) whose string table cannot show object-literal structure. What was verified: the bundle differs from the previously installed build's bundle (sha256 `0f860b70…` vs `a643aeb9…`; 5 310 716 vs 5 310 704 bytes), and the only bundled source change between those two builds is `823d412` (the other two commits since are a test file and documentation, neither bundled). The window opened at **2026-09-21 11:14** (app launched 11:12, backgrounded 11:14) and its reading is due **2026-09-22 ~11:14**. At window start: `consecutive_unclosed_cycles=0`, `is_cycle_active=0`, `last_cycle_stage=closed`, `sync_cycle_lock` empty, `operation_log` `synced=24` with nothing unsynced, native journal at its 500-row cap with the newest transition at 09:41. The mechanism was proven alive in the same pass (this project's rule: a flat journal is not evidence unless the mechanism is proven live): foreground service `isForeground=true types=0x40000000`, `dumpsys alarm` reporting `expo.modules.foregroundsyncticker.TICK_ALARM` on the `ELAPSED_WAKEUP` clock, and with the bridge brought up a real background cycle closed at 11:42:40 (`runOnce invoked (triggerSource='background_task', cycleId=d12955a3-…)`, journal `idle→checked→sent→applied→closed`) while the counter stayed 0. The acceptance instrument now runs **twelve** checks (formerly eleven) and reported **12/12 PASS, 0 failed, 0 unknown** at 11:52: the "Engine invoked" check no longer false-FAILs by construction (pid-scoped like the seam check; a designed refusal is explained by the T6 presence gate, while an unreadable gate state or an unreachable bridge with a complete config stays UNKNOWN, never PASS), and a new **cycle-closure** check reads the newest `sync_runtime_status` row and enumerates journal cycles whose newest transition is non-terminal — the §9 metric measured by the instrument instead of by hand (the host-`sqlite3` half moved to `scripts/lib/device-db-checks.mjs`, the file having reached its 500-line cap).

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
- Surface: the native module or the persisted WorkManager job; whichever the evidence supports.
- Requirement: settle the narrowed question below before changing anything about triggers.
- Evidence and what is open: the background-task path delivered real work with the app closed, so a
  trigger that does not need the UI exists. Unknown and worth measuring: (a) the runtime status reads
  `is_background_task_registered=0` while foreground-service mode is active, yet that job ran — so the
  flag and reality disagree and the flag should not be trusted as evidence of absence; (b) whether the
  job survives a reboot; (c) what happens on an install that never completes a startup.
- Do not retire the WorkManager path (T8) until (a) and (b) are answered.

## Sequence

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. T2 before T3 is deliberate: if an attempt cannot report,
the next attempt's sweep must be able to recover it from durable state, and that requires the journal
first. T5 may run in parallel with T3/T4 only if the store split lands before T7.

## Acceptance

- No attempt ends without a terminal journal state (`closed`, `failed`, `abandoned`).
- `consecutive_unclosed_cycles` stays 0 for 24 h with the app closed.
- Zero JobScheduler `Client timed out` stops for the app, and the stand-by bucket is not `45`.
- A no-op attempt costs milliseconds with the bridge absent.

### 24 h window (opened 2026-09-21 11:14, reading due 2026-09-22 ~11:14)

**Protocol.** App launched 11:12 and backgrounded 11:14 on the lab build `build-1790006856748`
(carrying `823d412`); no further interaction until the closing read.

**Baseline at window start.** `consecutive_unclosed_cycles=0`, `is_cycle_active=0`,
`last_cycle_stage=closed`, `sync_cycle_lock` empty, `operation_log` `synced=24` with nothing
unsynced, native journal at its 500-row cap with the newest transition at 09:41. The mechanism was
proven alive in the same pass — foreground service `isForeground=true types=0x40000000`, `dumpsys
alarm` reporting `expo.modules.foregroundsyncticker.TICK_ALARM` on the `ELAPSED_WAKEUP` clock, and a
real background cycle closed at 11:42:40 (journal `idle→checked→sent→applied→closed`) while the
counter stayed 0. This project's rule applies: a flat journal is not evidence unless the mechanism is
proven live.

**How the verdict is read.** Instrument check 10 (`Cycle closure`) plus the journal. **If no cycle
runs during the window, the row must be recorded as VOID for the metric instead of a zero.**

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
| T3 | implemented (budget clock), committed (`739fa8a`) — device acceptance open | Cause **confirmed from the Android clock semantics, not assumed**: `Handler.postDelayed` is delivered against `SystemClock.uptimeMillis()`, which does not advance while the CPU is suspended, so the 30 s budget was never exceeded in the watchdog's own clock and it never fired -- matching the measured 78 s of wall clock with no `abandoned` row. The budget is now an absolute deadline on `SystemClock.elapsedRealtime()`, re-checked when the callback is delivered; an unarmable watchdog refuses the attempt and traces the refusal as an `abandoned` journal row instead of running without a budget. Honest limit: user-space code cannot run while the CPU sleeps, so the guarantee is "fires at the first schedulable moment after 30 s of wall clock". Kotlin compile verified (`BUILD SUCCESSFUL`). **One `abandoned` row has now been observed on device — but it was written by the recovery sweep,
not by the watchdog at its budget, so a watchdog-triggered abandon is still unobserved.** Note 2026-09-21: the acceptance instrument (now twelve checks) measures this open item; the verdict is unchanged and remains open until a watchdog-triggered abandon is observed. |
| T4 | done — device evidence verified 2026-09-21 | `SyncEngineRecovery.sweep(cycleId)` is called from `SyncEngineCycle.runCycle` right after the lease claim. **On device at 08:17:59 the sweep reclaimed an abandoned attempt: the journal carries `ffbf5499 sent→abandoned (recovered by later attempt 8caaba48-9419-424d-b5cd-6bcccfe7e593)`, and the same attempt then claimed and delivered the batch.** Three orphan `processing` rows observed earlier in the day returned to `pending` at application start. The lease-expiry half is still unobserved. |
| T5 | in progress — blocked-with-reason on the first clause; slice B1 (fence + repair twin) in flight | **Read-only reconnaissance 2026-09-21: the second acceptance sentence, "a reclaimed lease rejects the previous owner's writes", is false today.** `sync_cycle_lock` is `(id, owner, expires_at)` with **no fence column anywhere** (`src/infrastructure/db/startup/startup.constants.ts:34-38`); not one native write checks ownership; the owner is the constant `"native_engine"` (`SyncEngineDatabases.kt:15`) and the release is `DELETE … WHERE id = ? AND owner = ?` (`SyncCycleLease.kt:63-77`), so a stale attempt's `finally` deletes the current row — reclaiming a lease only prevents *new* claims. The column cannot arrive through the table DDL because `SYNC_CYCLE_LOCK_TABLE_SQL` is applied with `CREATE TABLE IF NOT EXISTS` (`client.helpers.ts:283-285`) — a silent no-op on installed devices — so it must come through the `PRAGMA table_info`-driven repair twin enforced by `tests/infrastructure/db/migration-repair-parity.test.ts`. There is **no Kotlin unit-test harness** in this repo (no test source set under `modules/sync-engine/android/`). The first clause, "a parked UI write does not delay an attempt", has **no deterministic device producer**: nothing in the app can park a UI write on demand (recorded as an architecture-doc §10 open question). **Frozen contract the implementation follows:** `sync_cycle_lock` gains `fence TEXT` holding a **unique per-claim token** (native: the attempt's `cycleId`); the claim sets it and reads its own `fence`/`owner` back; every destructive or monotonic write becomes fence-scoped and a non-matching fence means **lost ownership** (stop writing, abandon, record); deliberate exceptions must be named with their reason; the TS twin mirrors the same contract. Slice B1 (fence + repair twin) is in flight; the store split (B2) is deliberately separate and **must not be merged into it**. |
| T6 | implemented, committed (`6b10bcd`); native interlock half `671d38b` — device acceptance open | Measured defect (device, 2026-09-21, pre-T6 build, bridge down): **125 failed attempts, one every 10 seconds**, each paying the full 10 s connect timeout — a 100 % duty cycle of failing attempts, with nothing stopping a tick from starting while the previous attempt was still timing out. The fix gates every tick on a `GET /api/status` probe (1500 ms budget; any HTTP answer counts as present), enforces one attempt in flight, and backs the cadence off across ticks (1x/2x/4x/8x of a 60 s base, capped at 15 minutes, ±20 % jitter, reset on first success), never lengthening the ladder for a 4xx. 47 focused tests cover the ladder, the jitter bounds, the reset, the refusal and the in-flight block. **Measured on device 2026-09-21: the probe was observed answering — `GET /api/status` returned
HTTP 200 to the app's okhttp client — and with the bridge absent the gate produced no cycles across
a 2.5-minute window while the foreground service and its tick alarm were both verifiably alive (the
alarm was scheduled, the service was `isForeground=true`). Still NOT measured: the exact cost of a
refused attempt with the bridge absent (the < 2 s claim) and the guarantee that such an attempt
writes nothing. An earlier 4-minute observation of a flat journal remains VOID because in that
window the app's sync runtime had not started at all.** Note 2026-09-21: the acceptance instrument
(now twelve checks) measures this open item (the exact cost of a refused attempt); the verdict is
unchanged and the `< 2 s` claim remains unmeasured. |
| T7 | done — device acceptance verified 2026-09-20 | Engine implemented and committed; invocation provable (`cf71725`: `SyncEngine: runOnce invoked (...)` before anything else, completion line with outcome/stage/elapsed, once-per-runtime JS warning when the native module is missing), reachable from the active path (`e038901`), and registered at runtime (`4654779`). **On device (2026-09-20 23:13): with the bridge off, the native engine delivered operation id 19 (created 23:05:04) in background with the app closed — journal `idle→checked→claimed→sent→applied→closed`, the operation reached `synced`, cursor 2352 → 2358; background attempts cost 13–26 ms afterwards.** Remaining measured gap closed on 2026-09-21 (`2b70829`): the empty-backlog attempt now issues the reconcile request pull-only through the same parse/stage/cursor pipeline, and the response-apply step was extracted verbatim into `SyncEngineResponseApplier.kt` — verified byte-identical against the previous `applyResponseWrites` — so both attempt shapes share one writer. The pull-only journal reads `checked→sent→applied→closed` with no new state names, and the claimed path is unchanged. Kotlin compile verified (`BUILD SUCCESSFUL`); device evidence for the pull is open. |
| T8 | deferred, with reason | (1) The trigger story must be settled first. The WorkManager path did deliver real work with the app closed, so a trigger that needs no UI exists — but the runtime status reads `is_background_task_registered=0` while that very job was running, and whether that job is registered and survives when the app never completes a startup, or across a reboot while foreground-service mode is active, is unmeasured (T12). Retiring the JS scaffolding before that is settled would risk removing the only trigger that does not need the UI. (2) Its own evidence is "the acceptance metrics still holding afterwards", and the 24 h metrics of architecture-doc §9 were not measured. T8's text also lists "the native ticker" for removal, which is now the only FGS tick source, so the task needs a re-scope before it is implemented. |
| T9 | done — device acceptance verified 2026-09-21 | The build carrying `671d38b` and `6b10bcd` delivered the three real pending operations in the background: journal `idle→checked→claimed→sent→applied→closed` at 08:17:59 (296 ms), with the earlier abandoned cycle reclaimed by the sweep, `synced=22` and nothing unsynced, cursor 2359 → 2362 on device and bridge, a pull-only reconcile answered 202 and the presence probe answered 200. Instrument: 11/11 PASS, 0 execution-guard burns, stand-by bucket 10 EXEMPTED. **Both background triggers are now observed on device.** The 08:17:59 delivery came from `triggerSource='background_task'`; a second measurement at 09:41:37 delivered a fresh pending operation from `triggerSource='foreground_service'` (the notification's service tick), with the bridge capturing the push at 14:41:20 (cursor 2362, one operation) and the cursor advancing 2362 → 2365. The operation used for that second measurement was seeded directly into the app's store with the target anime's current values — app stopped, backup taken, `integrity_check` ok, stale sidecars removed — so the bridge applied the state it already held and no user data changed. The 24 h metrics of §9 were not measured. |
| T10 | done | The temporary `console.warn('[fgs] foreground sync work started')` diagnostic is **removed** in `6b10bcd`, together with its marker comment. Its removal condition had been met (`ForegroundSyncTicker:ticking` was observed on device), and the ticker was restructured afterwards so the marker's assertion no longer described the code anyway. |
| T11 | implemented, committed (`0db36e5`) — device acceptance open | The lock is no longer held for the whole ticking lifetime: one reference is acquired per dispatched tick and released when JS reports the cycle settled through the new `notifyCycleComplete()` (a rejection settles too), with a 120 s `acquire(timeout)` safety net for a cycle that never reports back. Inter-tick scheduling moved from `Handler.postDelayed` to
`AlarmManager` `setAndAllowWhileIdle` with `ELAPSED_REALTIME_WAKEUP` (a clock that counts suspend
time) — deliberately inexact, so no exact-alarm permission is requested and the module manifest
declares none. Kotlin compile verified (`BUILD SUCCESSFUL`); 33 focused tests green, covering release-on-resolve, release-on-reject, and one release per dispatched tick. **Measured on device 2026-09-21: the lock was never held across 100 s of idle sampling (20 s apart), which is the per-cycle scoping working.** Note 2026-09-21: the acceptance instrument (now twelve checks) measures this open item (the ticker wake-lock scoping); the verdict is unchanged and device acceptance remains open. |
| T12 | re-scoped and narrowed 2026-09-21 | The original finding was overstated. Corrected evidence: the WorkManager worker **does** exist and **does** fire — the 08:17:59 delivery came from `triggerSource='background_task'` — so the app does have a background trigger that does not need the UI. The observation of "zero registered jobs for the package" was taken while the app had not completed startup (the keyguard window), which is why it does not prove a missing trigger in the normal case. What stays open is narrower: whether that job is registered and survives when the app has never completed a startup since install, and whether it survives a reboot while foreground-service mode is active (the runtime status reads `is_background_task_registered=0` in that mode). T8 still must not retire the WorkManager path before this is settled. |

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
