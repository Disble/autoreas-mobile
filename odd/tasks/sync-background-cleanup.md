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
| T1 | S2 | inline | done: RED (5 Kotlin tests did not compile, 3 plugin tests failed), GREEN; ticker module 55/55 + Kover; plugin 14/14 | (this commit) |
| T2 | S3 | inline | pending | |
| T3 | S4 | inline | pending | |
| T4 | S5 | inline | pending | |
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
