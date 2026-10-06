# Battery exemption prompt

Branch: `feat/battery-exemption-prompt` (from `dev` at `a91136b`)

## Objective

Tell the user proactively that the app needs the Android battery-optimization exemption for
background sync, instead of hiding it at the bottom of Settings.

## Problem / why

The exemption is the missing pillar for 24 h background survival (FGS + Doze allowlist), but the
only entry point is a row at the bottom of the Settings sync card. Users never discover it, so the
OS kills background sync and the app silently stops converging.

## Scope (user-approved, 2026-10-06)

1. **First prompt**: a HeroUI dialog shown once, at the same app instant as the notification
   permission request (right after pairing, when the sync runtime becomes enabled). Independent of
   the notification permission: no coupling, no merged dialog. Shown only when the native module
   is available (Android build), the bridge is configured, and the app is not already exempt.
   "Allow" launches the existing one-tap system dialog; "Not now" closes. Either answer records
   that the prompt was shown; it never appears again.
2. **Last reminder**: one time only, if the user declined, is still not exempt, and there is
   evidence background sync stopped running (no background attempt for a long window). After that,
   Settings is the only path.
3. **Settings row**: visibly highlighted (warning tone) while not exempt.

Out of scope: notification permission flow, Google Play policy (APK is sideloaded), native code.

## Constraints

- Persistence is SQLite/drizzle only. The flag must survive re-pairing, and
  `persistPairedBridgeConfiguration` deletes and reinserts `bridge_config`, so the flag lives in a
  new singleton table. The table is repair-step-only (no migration file), following the
  `active_season_cache` / `sync_cycle_lock` precedent, plus a `REQUIRED_SCHEMA_TABLES` entry.
  Rationale: a migration 0016 would bump `EXPECTED_SCHEMA_READINESS_VERSION` and its Kotlin twin in
  `SyncEngineDatabases.kt` (native code, out of scope); installed devices still get the table
  because the missing required table fails readiness validation, which falls through to
  `runMigrations` (`startup.helpers.ts:91-126`).
- `src/app/**` composes routes only; the global prompt mounts in `resolveStartupBoundaryRootContent`
  next to `SyncRuntimeGate` (inside SQLiteProvider + HeroUINativeProvider).
- The Android permission dialog is a separate activity drawn above the RN view, so a dialog shown
  at the same instant naturally appears after the system dialog closes; no sequencing coupling.
- User-facing copy: neutral Spanish. Artifacts (code, tests, docs) in English.
- Dumb `.tsx`, logic in `use-*.ts`, pure helpers tested first (RED → GREEN → MUTATE).

## Delivery

Strategy: `single-pr` resolved as a local branch merged into `main` (no push, no PR). Forecast
~700 authored lines. Work-unit commits per task without asking (standing authorization).

## Tasks

- [x] **T1 Persistence + seam availability** (delegated: repair step + helpers + tests, 2+ non-trivial files)
  - `app_preferences` singleton table, repair-only `ensureAppPreferencesTable` (no migration 0016),
    `REQUIRED_SCHEMA_TABLES`.
  - Columns: `batteryPromptShownAt` (nullable ms), `batteryReminderShownAt` (nullable ms).
  - `isAvailable()` on `createNativeBatteryOptimizationExemption`.
  - Checks: helper/hook tests, migration-repair-parity test, typecheck.
- [ ] **T2 Decision helpers** (delegated with T3: pure helpers + tests)
  - `shouldShowBatteryPrompt`, `shouldShowBatteryReminder` (silence window on `lastAttemptAt`).
- [ ] **T3 Global prompt component** (delegated: generate:feature scaffold, hook, dialog, mount)
  - Checks: component + hook tests, react-doctor diff.
- [ ] **T4 Settings row highlight** (delegated)
- [ ] **T5 Close**: `npx lefthook run pre-commit` green, merge decision left to the user.

## Progress / evidence

### T1 (delegated writer)

- RED: new suites failed before implementation (`Cannot find module ...battery-exemption-preferences.helpers`,
  `app_preferences` absent after `runMigrations`, `isAvailable is not a function`): 5 failed / 6 passed.
- GREEN: `npx jest tests/infrastructure/db/ensure-app-preferences-table.test.ts tests/features/battery-exemption
  tests/features/sync/native-battery-optimization.helpers.test.ts` -> 17 passed.
- Contract updates: required-table count 8 -> 9 in startup tests, repair writer order gains
  `CREATE TABLE IF NOT EXISTS app_preferences`, `runMigrations` statement count 8 -> 9.
- MUTATE: replacing the keep-first `coalesce` with a plain overwrite fails
  "never overwrites an existing prompt timestamp"; restored with `git checkout --`.
- `npx tsc --noEmit`: exit 0. Focused `tests/infrastructure tests/features/sync tests/features/settings
  tests/app tests/features/battery-exemption`: 126 suites / 1120 tests passed.
- `npx lefthook run pre-commit`: first run failed only `fallow` (stale `coverage/` read while the
  parallel `test --coverage` job rewrote it) and Stryker reported 1 survived mutant on `isAvailable`
  (redundant `!== undefined`, removed); second run green (fallow, lint, typecheck, test, mutation 100%).

## Next step

T2.
