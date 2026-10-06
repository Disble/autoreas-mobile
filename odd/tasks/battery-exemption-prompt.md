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
- [x] **T2 Decision helpers** (delegated with T3: pure helpers + tests)
  - `shouldShowBatteryPrompt`, `shouldShowBatteryReminder` (silence window on `lastAttemptAt`).
- [x] **T3 Global prompt component** (delegated: generate:feature scaffold, hook, dialog, mount)
  - Checks: component + hook tests, react-doctor diff.
- [x] **T4 Settings row highlight** (delegated)
- [x] **T5 Close**: `npx lefthook run pre-commit` green, merge decision left to the user.

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

### T2 (delegated writer)

- T1 commit: `b5a4501`.
- RED: with `false`-returning stubs, `npx jest tests/features/battery-exemption/battery-exemption-decision.helpers.test.ts`
  -> 2 failed / 13 passed (both positive cases); before the stubs the suite failed on the missing module.
- GREEN: same command -> 15 passed.
- MUTATE (staged green, guard deleted, focused test, `git checkout --` restore): dropping the
  `promptShownAt === null` guard, the `reminderShownAt` guard, the prompt-age window, the silence
  window, or `isAvailable` each fails 1-2 tests.
- `npx tsc --noEmit`: exit 0. Pre-commit: first commit attempt failed `lint` (missing JSDoc on two
  test constants, fixed); Stryker's staged scope (`stryker.dlinter.json`) does not list the new
  helpers, so the manual mutation above is the mutation evidence.

### T3 (delegated writer)

- T2 commit: `9a19ab1`.
- Scaffold: `npm run generate:feature battery-exemption BatteryExemptionPrompt`; the unused zod
  `.schema.ts` was deleted, the placeholder label/tests were replaced.
- RED: `resolveBatteryExemptionPromptVariant is not a function` (5 tests), the startup integration
  test's new "prompt mounts beside the sync gate" assertion failed, and the hook suite failed
  13/13 against the scaffold.
- GREEN: `npx jest tests/features/battery-exemption tests/features/startup tests/app` -> 176 passed;
  battery-exemption alone 43 passed.
- MUTATE (staged green, `git checkout --` restore): removing the latch (2 fail), the readiness gate
  (3 fail), the AppState exemption re-read (1 fail), or the `requestExemption()` call (1 fail) is
  caught. Swapping prompt/reminder order survives because the two decisions are mutually exclusive
  on `promptShownAt` (equivalent mutant); the test was renamed to state that.
- `npx -y react-doctor@latest . --verbose --diff`: 100/100, no issues. ESLint `jsx-max-depth`
  warning fixed by extracting the actions component. `npx tsc --noEmit`: exit 0.
- Pre-commit first attempt failed `fallow` (`useBatteryExemptionPrompt` cognitive complexity 20);
  split into `use-battery-exemption-foreground-state.ts`, `use-battery-exemption-preferences.ts` and
  the `recordBatteryExemptionDialogShown` helper (3 new tests). Latch mutation re-checked (2 fail),
  react-doctor re-run 100/100, `bun run audit` exit 0, battery-exemption suite 46 passed.

### T4 (delegated writer)

- T3 commit: `5b79097`.
- RED: `use-settings-screen.test.ts` "highlights the battery-exemption row only on an available,
  non-exempt device" failed (`isBatteryExemptionHighlighted` undefined); `settings.test.tsx` warning
  test failed (no `settings-battery-exemption-warning`). The "unavailable -> plain row" test passed
  before and after: it pins unchanged behavior.
- GREEN: `npx jest tests/features/settings tests/app tests/features/battery-exemption` -> 124 passed.
- MUTATE: dropping `isAvailable` from the highlight derivation fails 2 tests; never rendering the
  warning fails 1; restored with `git checkout --`.
- Row extracted to `SettingsBatteryExemptionRow.tsx` (warning `HeroAlert` + primary
  "Activar excepción" button; exempt and unavailable states keep the previous plain row). Copy moved
  to `BATTERY_EXEMPTION_ROW_COPY`. Its file-level `jsx-max-depth` disable mirrors the justified one
  in `SettingsSyncCard.tsx`.
- `npx tsc --noEmit`: exit 0. `npx -y react-doctor@latest . --verbose --diff`: 100/100.

### Commits

- T1 `b5a4501`, T2 `9a19ab1`, T3 `5b79097`, T4 `087e516` (each passed `npx lefthook run pre-commit`
  through the commit hook).

### T5 (parent)

- Parent spot check: `npx jest tests/features/battery-exemption` -> 5 suites / 46 tests passed.
- Branch tip clean; every work-unit commit passed the lefthook pre-commit hook.
- RDD: `gentle-ai review mode status` -> off (global); no native review.
- Size: 43 files, +1697/-46 (forecast ~700); growth came from tests, the fallow-driven hook split,
  and contract-count updates in existing startup/db tests.
- Pending: on-device check (pair -> dialog, decline -> no repeat, Settings warning), and the
  merge decision (user).

## Next step

Device check, then local merge to `main` if the user approves.
