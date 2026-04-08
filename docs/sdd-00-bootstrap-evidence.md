# SDD-00 bootstrap evidence

## Why this note exists

SDD-00 now leaves the repo with a real bootstrap foundation and a restored repo-wide quality gate. The earlier HeroUI Native template debt was removed, so the current evidence reflects the REAL post-cleanup baseline that future specs inherit.

## Current repo-wide pre-commit gate

- Lefthook now runs a repo-wide gate again:
  - staged-file lint via `bunx eslint {staged_files}`
  - full typecheck via `bunx tsc --noEmit`
  - full test suite via `bun run test`
- This is stronger than the temporary scoped exception used during the dirty-template phase because it validates the real repo baseline instead of a bootstrap allowlist.

## Near-runtime evidence added in this reapply

### 1. Pre-commit fail path

- Reproducer: `bun run verify:precommit-fail-path`
- What it does:
  1. creates a temporary staged file under `tests/.sdd-temp/`
  2. injects intentionally broken TypeScript/TSX staged code
  3. runs `bunx lefthook run pre-commit --force --no-tty`
  4. asserts the hook exits non-zero
  5. cleans the staged file and temp directory

This is near-runtime evidence because it exercises the REAL current Lefthook entrypoint without creating a commit.

### 2. Drizzle `.sql` bundling support

- Evidence test: `tests/smoke/sql-migrations-bundling.test.ts`
- Fixture: `tests/fixtures/sql/sample-migration.sql`
- Proof points:
  - Babel inlines the `.sql` import into a runtime string
  - Metro config still includes `sql` in `resolver.sourceExts`

This does not replace a device bundle, but it proves the repo-level import contract that Drizzle migrations need.

### 3. Android cleartext wiring

- Evidence test: `tests/smoke/android-cleartext-config.test.ts`
- Proof point: `app.json` keeps the `expo-build-properties` plugin with `android.usesCleartextTraffic: true`

### 4. Real app shell smoke

- Evidence test: `tests/smoke/app-shell.test.tsx`
- Proof points:
  - renders the CURRENT `src/app/(home)/index.tsx` Autoreas shell
  - asserts visible baseline copy from the actual app shell
  - mocks only RN/infra wrappers (`ScreenScrollView`, theme hook, text wrapper) to keep the smoke deterministic in Jest while still exercising the real shell module and copy

## What still cannot be fully proven here

Without `expo prebuild`, an Android build, or a device/emulator run, this repo cannot materialize and inspect the generated `AndroidManifest.xml` nor execute a real `http://192.168.x.x` request on Android. That is a hard environment limit, not a missing bootstrap setting.

So the current evidence is the strongest safe proof available under the rules:

- config-level proof for cleartext wiring
- near-runtime proof for the pre-commit abort path
- Jest/Babel/Metro-level proof for `.sql` migration imports
- smoke proof for the actual current Autoreas shell
