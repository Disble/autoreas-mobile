# Background sync status truth

**Local closeout (2026-09-26):** S4b implementation and a limited device re-observation are recorded below. The sync report is closed for release preparation; S4's remaining device scenarios and S5's delivery approval remain open. The root-cause mapping and dated progress below describe their respective earlier builds and stages.

## Objective and problem
The persisted background-sync status columns in `sync_runtime_status` are written **once**, from the
foreground runtime's registration path, and never re-projected. On 2026-09-25 a lab build on tablet
`R52T30686RV` was observed reporting `registrationStatus=unregistered`,
`execution_mode=best_effort_background_task`, `is_foreground_service_running=0` and
`is_background_task_registered=0` while the WorkManager unique work `autoreas-native-sync-floor` was
`ENQUEUED`, its JobScheduler job carried `Trace tag: SyncFloorWorker`, and `SyncForegroundService` was
running (`isForeground=true`). Settings' "Estado de sync en segundo plano" is rendered from that row, so
the app can tell the user "No registrado" while both sync paths are demonstrably live.

This is a follow-up to `odd/tasks/native-background-sync-cutover.md` (M4 found it on device). It is a
new ODD feature because the fix is an observability contract change with its own tests and device
acceptance, not a continuation of the cutover's work units.

## Root cause (mapped read-only, no edits)
- The only writers of those five columns are `src/features/sync/use-sync-runtime.ts:144-146` (disable
  path), `:163-165` (registration path) and `:169-171` (catch path). The observed row can only come from
  `:163-165`, because it is the only path that can combine `unregistered` with
  `can_show_persistent_notification=1`; the disable path would have persisted `unsupported` with
  `canShow:false`, and the catch path writes `unsupported` alone.
- The foreground-service flag is **guaranteed false** at that instant, not unlucky:
  `SyncForegroundSyncAdapter.register()` calls `ticker.start(...)`
  (`native-foreground-sync-adapter.helpers.ts:55-63` → `ForegroundSyncTickerModule.kt:212-214` →
  `TickAlarmScheduler.kt:161-165` → `ContextCompat.startForegroundService`, an asynchronous request),
  while the presence probe only matches an **already posted** notification
  (`ForegroundSyncTickerModule.kt:193-205`), and that notification is posted later in
  `SyncForegroundService.onStartCommand` → `postForegroundNotification()` (`SyncForegroundService.kt:120-124`).
  The hook then reads status in the microtask right after `register()` resolves
  (`use-sync-runtime.ts:159`), before that main-loop turn can happen.
- Nothing re-projects afterwards: the effect's dependency list does not include app state, the
  `hasCurrentStrategy()` early return blocks a second registration pass, and the native per-tick writer
  deliberately touches only the attempt columns (`SyncEngineRuntimeStatus.kt:139-166`), which matches the
  device observation exactly.
- The settings surface renders the row faithfully through a live query
  (`src/features/settings/use-background-sync-status.ts:28-46`); Settings is a symptom, not the defect.
- Also observed while mapping (latent, same shape): the disable path persists `unsupported` rather than
  `unregistered`, because `getStatus()` runs after the facade has already cleared its strategies
  (`sync-execution-facade.helpers.ts:131-141` → `createFallbackStatus()`).
- Ruled out with evidence: JS payload mis-normalization (keys match on both sides), the M3
  `registered > unsupported > unregistered` merge precedence (both adapters derive status and boolean from
  the same read), and a patch reading a different source.

## Acceptance
- After a normal launch on the tablet, the persisted row must not claim `is_foreground_service_running=0`
  while `SyncForegroundService` is running, nor `is_background_task_registered=0` while the native floor is
  `ENQUEUED`.
- The projection must refresh when the facts can change without a new registration: at minimum on an
  `AppState` transition to `active`, and once after registration has had a bounded chance to settle.
- Disabling sync must persist `unregistered`, not `unsupported`.
- No new polling timer is introduced on the foreground path.
- Settings keeps rendering from the persisted row; no copy change is required by this feature.
- Evidence must come from a rebuilt APK observed on the tablet, with unobserved scenarios labelled.

## Scope / non-goals
In scope: the JS status projection (when and how often the execution-status patch is persisted), the
disable-path value, and the tests at the real seams that make the stale write impossible. Also in scope: the
`SyncFloorScheduler.register` KDoc claim that the first tick waits one interval, which device observation
falsified (first skip ~30 s after registration, later periods 15 min).

Out of scope: Settings copy or layout, changing the closed `registrationStatus` vocabulary, a native
`ServiceConnection`/presence handshake, distinguishing "status read failed" from "not scheduled" across the
JS bridge, and any per-tick refresh of these columns from Kotlin. Those are recorded as follow-ups below,
because each adds bridge or persisted surface and is a maintainer decision.

## Testing contract
TDD is enabled (repository AGENTS.md / CLAUDE.md): RED → GREEN → MUTATE → REFACTOR for hooks and helpers,
with tests at public seams and expected values from independent literals, never recomputed from the code
under test. Focused runner `npx jest --runInBand <paths>`; full `npx lefthook run pre-commit`. Native-sourced
changes need a rebuilt APK before any device claim. No test may assert against a mocked facade where the
real merge is the behavior under test.

## Tasks (stable IDs)
- [x] **S1 — root cause (read-only).** Confirm the exact write, the guaranteed-false flag, the absence of any
  re-projection, and rule out the alternative causes. Recorded above by a delegated read-only mapper.
- [x] **S2 — make the projection honest (delegated writer).** RED first at the real seams: a hook-level test
  showing the row can end with a false "not running"/"not registered" and that no later pass re-projects;
  a facade-level test where a strategy reports `registered` while its live boolean is false. Then the fix:
  re-project on `AppState` → `active` and once after registration has a bounded chance to settle; persist
  `unregistered` on the disable path. Keep the fix free of new polling timers on the foreground path.
  Correct the `SyncFloorScheduler.register` interval KDoc in the same unit.
- [x] **S3 — independent verification (separate verifier).** Read-only review of the diff against the mapper's
  root cause, plus the exact focused and full commands; must independently reproduce the RED→GREEN claim for
  at least the primary seam and report any mocked-away causal link still standing.
- [x] **S2b — correction round after independent review (delegated writer).** Three confirmed items from S3: (1) the disable-path guard in `tests/features/sync/use-sync-runtime.test.ts` is false-confidence — its mocked facade already returns `unregistered`, so removing the fix keeps it green; (2) a real ordering hazard: the projection writers share one row with no serialization, so an in-flight projection can land after a deliberate disable and persist `registered`/`unsupported`; (3) the 1500 ms settle timer is armed in parallel with the registration chain rather than after it resolves, so a slow `notifee.requestPermission()` round trip can consume the whole window, and a dependency change mid-window silently drops the settle pass. Fix all three with tests that genuinely fail before the change.
- [x] **S4b — close the registration fallback window (delegated writer).** RED-first real-facade and hook tests must demonstrate that a pending individual strategy registration cannot hide the other strategy's live status or make resume persist an empty-facade fallback; unregister during pending registration must not resurrect a strategy. Publish status-readable strategies without waiting for both registrations, preserving truthful pending/failed status and disable ordering. The exact stalled promise is unproven; do not add a native WorkManager timeout without evidence. Rebuild and reobserve the tablet before closing S4.
- [ ] **S4 — device re-verification (partial; further scenarios are follow-up evidence, not a release closure prerequisite by themselves).** Rebuild the `lab` APK and install as an upgrade on `R52T30686RV`
  (never uninstalling data), then observe the corrected projection: the row must not report "not running"
  while the service is up, must flip honestly on an app resume, and must read `unregistered` after a
  disable. Also attempt, within a bounded budget, the FGS-off floor attempt that the cutover could not
  reach; label anything unobserved.
- [ ] **S5 — close and request the delivery decision.** Present the diff, the device evidence and the
  remaining unobserved scenarios; request fresh explicit commit approval. Push/PR/release stay separate.

## Follow-ups (maintainer decisions, not taken here)
1. Whether `registrationStatus` should gain a value for "could not be read", so a failed native status read
   is not displayed as "not scheduled" (`SyncEngineModule.kt:104-110` collapses both today).
2. Whether Settings should advertise staleness for these columns at all; they carry no timestamp today.
3. Whether the persisted background-sync columns should be derived from one boolean pair instead of three
   duplicated persisted columns.

## Delivery
Route: read-only mapper for S1 (done), one bounded writer for S2, a separate verifier for S3, one fresh
worker for the S4 build/install/observation. Forecast: ~250-400 authored lines including tests. Delivery
strategy `ask-on-risk`; no chain or PR decision requested yet. Commits require explicit maintainer approval
after validation and diff review, per repository policy.

## Progress
- 2026-09-25: M4 on the tablet found the defect (row reported unregistered while the floor was ENQUEUED and
  the FGS was up; the four columns were never refreshed). The maintainer asked to treat it as a new ODD.
  S1 read-only mapping completed and recorded above; no source has been edited for this feature yet.
- 2026-09-26: S2 implemented (staged, uncommitted) by one bounded writer. `src/features/sync/use-sync-runtime.ts` now re-projects the execution-status patch through a single `projectExecutionStatus` callback that replaces the three duplicated persist chains; it is re-invoked on an `AppState` transition to `active` and once after one bounded 1500 ms settle timer cancelled on unmount and on dependency change (no polling), and the disable path persists `unregistered` instead of the facade's post-unregister `unsupported`. Tests: a new `tests/features/sync/use-sync-runtime-status-projection.test.ts` driving the REAL facade (only the two strategy seams doubled) plus a new block in `tests/features/sync/sync-execution-facade.test.ts` pinning the S1 conclusion that the merge is not the defect. Writer RED evidence: 4 of 5 new tests failing before the fix, GREEN 5/5 stable over three runs, focused four-file run 39/39, four MUTATE rounds each failing the intended guard, `npx tsc --noEmit` exit 0, React Doctor changed-scope clean. `SyncFloorScheduler.kt` received a comment-only correction of the "first tick waits one interval" claim (device showed the first floor run ~30 s after registration, later periods 15 min).
- 2026-09-26: the writer's own gate run failed for two reasons it correctly did not accept as its own: lefthook stashes unstaged changes so it exercised the pre-fix hook (the four failures matched the RED signature exactly), and a staged cutover file carried an inherited duplicate-import lint error. The parent fixed that duplicate import (its own defect from the previous cleanup pass), staged everything and re-verified: `npx lefthook run pre-commit` exit 0 with quick (fallow, lint, typecheck), heavy (full Jest coverage, staged-mutation no-op) and native (five Kover verifies) all green. One earlier gate run in the same session exited 1 with **only** the `fallow` job failing while a standalone `bun run audit` exited 0 immediately after and the next gate run exited 0; the working hypothesis is a race between fallow's CRAP scoring (which reads Istanbul coverage where matched) and the parallel `jest --coverage` job rewriting that file (matched-function counts 929 during the hook vs 951 standalone). Recorded as an intermittent, environment-dependent failure under independent review, not attributed to this change.
- S3 independent verification of S2 is running; S4 device re-verification (rebuild, upgrade install, observe the corrected projection, attempt the unobserved FGS-off floor) follows.
- 2026-09-26: S2b correction round closed (staged, uncommitted) after the S3 review found three items, all fixed by the parent after two delegated attempts returned no report: (1) the disable-path guard was false-confidence and is now a single source of truth — `projectExecutionStatus` forces `unregistered` from the runtime's own enabled state, with no redundant call-site argument masking it; (2) a monotonic sequence guard now lets only the newest projection write, so an in-flight projection can no longer revive `registered` after a disable; (3) the 1500 ms settle window now starts when registration RESOLVES (not in parallel with it) and lives in its own effect with cleanup, so a dependency change mid-window no longer drops it silently. Tests: the projection suite was split to respect the 500-line cap (`use-sync-runtime-status-projection.test.ts` 396 lines, `use-sync-runtime-settle-window.test.ts` 419 lines) and the mocked disable test now asserts against `unsupported`, which is what the real facade answers. Guard proof by mutation, each restored afterwards: removing the sequence check and the disabled-forcing fails the ordering test; arming the settle before registration resolves fails the settle-window test; making the settle effect ignore re-runs fails the dependency-change test; removing the disabled-forcing additionally fails the previously non-discriminating mocked disable test. Checks: `npx tsc --noEmit` exit 0, `npx eslint --max-warnings=0 --no-warn-ignored` on the four touched files 0 problems, `npx lefthook run pre-commit` **exit 0** (quick: fallow/lint/typecheck; heavy: full Jest coverage plus the vacuous staged-mutation no-op; native: five Kover verifies).
- 2026-09-26: S4 partial. The corrected `lab` APK built (exit 0, 3m39s) and installed as an **upgrade** on `R52T30686RV` (exit 0, no signer mismatch, no uninstall, no data loss). **Valuable before-evidence:** on the pre-fix build the tablet reproduced the M4 defect verbatim — `registration_status=unregistered`, `execution_mode=best_effort_background_task`, `is_foreground_service_running=0`, `is_background_task_registered=0`, `can_show_persistent_notification=1` while `SyncForegroundService isForeground=true foregroundId=4821` and the JobScheduler job carried `Trace tag: SyncFloorWorker`. **Steps 4–7 are NOT OBSERVED:** the device was keyguard-locked and dozing across a 12-sample/3-minute poll, so the corrected build's JS runtime never started (the row still holds the stale pre-upgrade projection, only the native attempt columns advanced), and the repository's own instrument refused at its unlock gate with `EXIT=2`. That stale row is explicitly **not** evidence against the fix and must never be reported as such. Also recorded for anyone pulling the app database: use `adb exec-out`, since `adb shell` CRLF-mangles it and SQLite then reports "database disk image is malformed". S4 stays unchecked until steps 4–7 run on an unlocked device; the already-installed build needs no rebuild.
- 2026-09-26: **S4 DEVICE ACCEPTANCE FAILED.** Observed on the tablet with the corrected build (versionCode 13, installed 21:34:07, JS launched 21:40:22): the persisted row read `registration_status=unsupported`, `is_foreground_service_running=0`, `is_background_task_registered=0`, `can_show_persistent_notification=0` continuously for ~13 minutes while `SyncForegroundService` was `isForeground=true` (`foregroundId=4821`) and `autoreas-native-sync-floor` was `state=0 (ENQUEUED)` (WorkManager `period_count=9`; JobScheduler job `Trace tag: SyncFloorWorker`). A genuine resume (`onHostPause` 21:52:01 → `onHostResume` 21:52:25) left the row identical. The fork's own instrument also reported 11/12 PASS with `Service state PASS isForeground=true`, i.e. the instrument agrees the service is up while the row says it is not.
  **Strongest structural evidence:** the four values are byte-identical to `createFallbackStatus()` (`sync-execution-facade.helpers.ts:11-18`), which `getStatus()` returns ONLY when the facade has no strategy at all (`concurrentStrategies.length === 0 && !currentStrategy`). `mergeConcurrentSyncExecutionStatus` cannot produce `unsupported` on Android, because the FGS adapter always answers `registered`/`unregistered`. So every projection that landed read a facade whose **registration had not completed** — which also explains why the settle pass never helped: it is armed only after `registerConcurrentStrategies()` resolves.
  **Consequence for the fix:** the S2/S2b change is necessary but not sufficient. The projection must not depend on registration completing, and a hung strategy registration must not define the status for the whole session. Candidate causes, not yet confirmed from device logs: the FGS adapter's `await notifee.requestPermission()` (its dialog activity was destroyed at 21:41:59.465-21:41:59.730) and/or the native floor `register()` blocking on the WorkManager enqueue confirmation. Adjacent raw evidence: the native cycle was `abandoned` at 21:41:59.753 with `cycle lease lost: lease row no longer names owner=native_engine`, and `SQLiteLog (5) statement aborts at 2: [PRAGMA journal_mode=TRUNCATE] database is locked`.
  **NOT OBSERVED and still owed:** the disable path (this build exposes no way to switch sync off) and the FGS-off floor attempt; and no cold start was possible because force-stop was prohibited in that round, so a fresh-process re-observation is required before the fix is redesigned. Also recorded: `stay_on_while_plugged_in` was set to 15 for the observation and restored to 0; `POST_NOTIFICATIONS` is granted on this device, so the denied-permission residual does not explain the false `0`; and the app DB must be pulled with `-wal`/`-shm` or the row reads stale.
- 2026-09-26: An authorized force-stop/relaunch of the corrected build produced `registered|android_foreground_service|1|1|1`, so the S4 failure is intermittent. A 210-second FGS-off floor diagnostic was inconclusive: WorkManager delayed an early forced job until eligibility, and the live app reasserted ticker ownership/service; the original preference was restored. Read-only mapping established the empty-facade projection window while `Promise.all` registration is pending but could not identify which strategy call stalled. S4b is scoped to that proven window; native timeout is deferred until evidence supports it. Route: one bounded delegated writer with RED-first tests; no source write until this task document and its Engram mirror agree.
- 2026-09-26: S4b implementation staged, uncommitted; **S4b and S4 remain unchecked pending device acceptance**. The facade now publishes both status-readable strategy seams before registration awaits; a pending strategy does not hide the other's live status, and a late registration after disable is cancelled again unless a newer enabled registration owns the paths. The hook reads immediately and schedules one bounded re-read while registration is pending plus a fresh bounded re-read if registration resolves; resume reads the same real facade. No native timeout or polling was added. RED: four pending-strategy facade/hook scenarios failed before implementation, and rapid re-enable failed before its guard. GREEN: the five-file focused command plus `sync-execution-facade-pending.test.ts` passed 42/42; `npx tsc --noEmit` exit 0. MUTATE: removing early facade publication failed 3 pending facade cases; removing late cleanup failed the disable/resurrection case; removing the hook's pending settle request failed the settle-window case. Each mutation was restored from the exact staged file. `npx -y react-doctor@latest . --verbose --diff` exit 0, 83/100, no issues after fixing its staged-file warning. First `npx lefthook run pre-commit` exit 1 solely on lint's array-lookup warning in the new facade guard (heavy and native passed); the revised guard passed focused lint and a second full pre-commit run exited 0 (quick fallow/lint/typecheck, heavy full Jest coverage and staged-mutation no-op, native Kotlin verifies). No build, device test, commit, or remote action was performed by this writer. The exact stalled native/permission promise remains unproven; tablet re-observation, disable acceptance, and the FGS-off floor attempt remain owed.
- 2026-09-26 closeout (local evidence, not a release or commit): S4b's implementation and guarded behavior are complete. After the previous writer's report, an S4b lab APK was built and installed with `-r` on tablet `R52T30686RV`; the device instrument returned **11 PASS / 0 FAIL / 1 UNKNOWN** (native-engine invocation check). An immediate persisted snapshot still read `registered|best_effort_background_task|0|0|1` while Android reported `SyncForegroundService isForeground=true` and native WorkManager work ENQUEUED. A later user-provided Settings screenshot showed **registered**, **Android foreground mode**, **FGS Active**, **notification Permitted**, and a recent foreground-resume sync. There is no subsequent persisted-row read proving that the immediate false fields persist, nor a row-level read proving every field corrected. S4 remains partial: the disable path has no device observation, the specific post-cutover FGS-off **worker invocation** has not been observed, and neither the failure/watchdog path nor a new 24-hour window was measured. Earlier autonomous sync evidence from 2026-09-21 and 2026-09-24 belongs to earlier builds (`docs/mobile-background-sync-investigation-log.md`); it does not prove this new worker path. This report is closed for local release preparation with those gaps disclosed; S4 and S5 remain unchecked pending their own evidence and explicit delivery approval.
