# Sync background cleanup

Objective: the sync service comes back by itself after a reboot or an app update, the 15-minute floor only syncs when the service is really gone, and every background-sync piece that no longer contributes is deleted.
Branch: `feat/sync-background-cleanup` from `main` at 290616d (2.8.0). Delivery: local merge (strategy `ask-on-risk`). Runners: Jest (`tests/`), Kotlin unit tests (`modules/*/android`), lab APK on the tablet.

## Specs

- **S1 — Owner's decision (verbatim).** "Me parece, entonces vamos a eliminar todo lo que ya no aporta a Mobile." It answers the recommendation: keep only what the floor needs, with its rule fixed so it checks whether the service is alive.
- **S2 — Service returns after reboot and after an app update.** A receiver for `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` re-arms the tick alarm and starts `SyncForegroundService` when the persisted ticking state says background sync is on (`readTickingState`, `TickAlarmScheduler.kt:61-67`), following `TickAlarmReceiver.kt:67-75`. `RECEIVE_BOOT_COMPLETED` is declared by our plugin, not inherited from a library. Android 15 forbids `dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection` and `microphone` services from `BOOT_COMPLETED`; ours is `specialUse` (checked 2026-11-14, developer.android.com behavior-changes-15).
- **S3 — Floor gate checks the service, not the alarm.** The floor skips only while `SyncForegroundService` is alive in `:sync`; with the service gone it runs a sync attempt even if the alarm token still exists. Evidence: 2.8.0 week 563 floor wakes, all `skipped_owned_by_ticker`; reboot test 2026-11-14 the floor was the only recovery (20:36:49 and 20:51:50).
- **S4 — Floor surplus removed.** `cancelLegacyExpoFloor` / `LEGACY_EXPO_UNIQUE_WORK_NAME`, `ownsBackground` in the JS floor payload, `SyncExecutionStrategy.mode`, retired-step comments in `native-background-floor`.
- **S5 — Native leftovers removed.** `modules/sync-journal` (no JS caller; `sync-journal.db` stays, written by `SyncEngineJournal`), ticker `isRunning`, `SyncForegroundService.start/stop` companion, `SyncEngineJournal.executor`, comments that describe retired paths.
- **S6 — JS leftovers removed.** Flush aliases `ws_disconnected` → `ws_sync_required`, `season_rating` → `local_mutation` (the operation name `season_rating` stays); dead `executionMode` state in `useSyncRuntime`; stale comments.
- **S7 — Notifee removed.** Its only runtime use is `notifee.requestPermission()`; replace it with React Native's `PermissionsAndroid` for `POST_NOTIFICATIONS`, then remove `react-native-notify-kit`, the plugin's Notifee service declaration, `FOREGROUND_SERVICE_DATA_SYNC`, the CI needles, the Jest mock and the release-skill lines.
- **S8 — Docs.** `ARCHITECTURE.md` background section rewritten to the live design; frozen-controls logbook row under "Changes under observation" (window ends 2026-11-17 22:45).
- **S9 — Device proof.** Lab build on the tablet: reboot without opening the app brings the service back; an update install brings it back; with the service stopped and the alarm left, the floor syncs.
- **Out of scope, found (2026-11-14 map):** Settings ORs floor and service status, so a registered floor hides a dead service; ticker `OnDestroy { stopTicking() }` persists `isTicking=false` on any React-host teardown. Both are bugs, not leftovers; reported to the owner, not fixed here.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S2 | inline | done: RED (5 Kotlin tests did not compile, 3 plugin tests failed), GREEN; ticker module 55/55 + Kover; plugin 14/14; native review approved (2 lenses), its WARNING fixed in 12274b5 | 0c2a0bb, 12274b5 |
| T2 | S3 | inline | done: RED (isAlive and serviceAliveCheck did not compile), GREEN; sync-engine 479/479; native review approved (2 lenses), its WARNING fixed in e96b9df | c5193ff, e96b9df |
| T3 | S4 | inline | done: Kotlin 477/477 + Kover; Jest sync 647/647; tsc clean | fae85df |
| T4 | S5 | inline | done: sync-engine 477/477, ticker 55/55, Kover | (this commit) |
| T5 | S6 | inline | pending | |
| T6 | S7 | inline | pending | |
| T7 | S8 | inline | pending | |
| T8 | S9 | inline | pending | |

Route evidence: units are small (about 100 changed lines or less each) and T1/T6 share `plugins/withAndroidForegroundSync.js`, so no writer trigger holds; the parent writes inline.

## Log

- L1 (2026-11-14, owner): "Me parece, entonces vamos a eliminar todo lo que ya no aporta a Mobile."
- L2: Reboot test 2026-11-14 on 2.8.0: boot 20:26:59; BOOT_COMPLETED reached the app only through Notifee's and WorkManager's receivers; no service; floor synced 20:36:49 (cycle `5cc4a41d…`, same id on the Bridge) and 20:51:50 (delivered a Bridge change made at 20:48). The floor never shows in Samsung's active-apps list (no foreground info).
- L3: Map by a read-only explorer (path:line evidence in the session); the inventory in S4-S7 comes from it.
- L4: T1. `SyncRestartReceiver` (ticker module, main process) handles `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` through `restoreBackgroundSync`, now shared with `TickAlarmReceiver`. Plugin declares it plus `RECEIVE_BOOT_COMPLETED`; release guard checks both. Risk: item 5 (release CI guard and manifest). Not yet on a device (T8).
- L5: Native review of T1 (resilience, reliability) approved with advisories; two WARNINGs were real: the Python edit lost a `\` line continuation in `release.yml` (two needles on one line) and the permission was never added. Fixed with the Edit tool in 12274b5; guard checked with `bash -n`.
- L6: T2. `SyncForegroundService.isAlive` (companion, `@Volatile`) is set in `onCreate`/`onDestroy`; `SyncFloorWorker.serviceAliveCheck` defaults to it (same `:sync` process). The wire outcome `skipped_owned_by_ticker` and `SyncFloorAttemptResult.SkippedOwnedByTicker` keep their names (Bridge vocabulary). `SyncTickerOwnership` is now read only by `SyncFloorScheduler.status`, removed in T3. Risk: item 4 (cross-component state; floor and service share `:sync`; if the floor ever ran elsewhere it would sync more, never less).
- L7: Native review of T2 (resilience, reliability) approved with advisories. Real WARNING: a live service whose tick alarm chain died syncs nothing, yet the floor skipped for it. Fixed in e96b9df: the floor skips only while the service is alive AND its tick alarm is armed (`SyncFloorWorker.tickAlarmArmedCheck`, default `SyncTickerOwnership::ownsBackground`); RED was the new test, GREEN after. The static `isAlive` flag is reset around the tests (SUGGESTION). So `SyncTickerOwnership` stays: it is the alarm half of the gate.
- L8: T3. Removed `LEGACY_EXPO_UNIQUE_WORK_NAME` and `cancelLegacyExpoFloor` (register no longer cancels anything; unregister cancels only the native floor), `ownsBackground` from `SyncFloorStatus`, the module payload and the JS map type, `SyncExecutionStrategy.mode` and the adapter's `mode`, and the M2/M3 cutover comments. Legacy-cancellation tests replaced by an unconfirmed-enqueue and a throwing-enqueue test. Risk: item 3 (the floor status payload loses `ownsBackground`; JS never read it).
- L9: T3 assessed after fae85df: medium, `under_budget` (slice c5193ff..fae85df pending review).
- L10: T4. Deleted `modules/sync-journal` (no JS caller since the M3 cutover; `SyncEngineJournal` is now the only writer of `sync-journal.db` and owns its schema), the ticker's `isTicking` field and `isRunning()` (JS never called it), `SyncForegroundService.start/stop` (no caller), `SyncEngineJournal.executor` (never used). Comments naming the deleted module or the retired JS floor rewritten; historical docs (`docs/`, older `odd/tasks/`) left as evidence. Two loader comments in `native-foreground-sync-ticker.helpers.ts` and `native-battery-optimization.helpers.ts` still name `sync-journal`: any staged change to those files fails the staged-mutation gate's dry run (known Expo 58 defect), so they wait for that fix. Risk: item 3 (the ticker module loses its JS `isRunning` function; no JS caller).
