# Autoreas Mobile

Autoreas mobile app built with Expo Router, React Native, Expo SQLite, Drizzle ORM, React Query, and HeroUI Native.

## Stack

- Expo SDK 55
- React Native 0.83
- Expo Router
- Expo SQLite
- Drizzle ORM
- React Query
- Jest + Testing Library
- Bun as the primary package manager

## Requirements

- Bun
- Node.js
- EAS CLI (`npm i -g eas-cli` or `bunx eas --version`)
- Android Studio if you plan to run Android locally
- Logged-in Expo account (`eas login`) for remote builds

## Important: SQLite and Android

This project uses native `expo-sqlite`.

That means **plain Expo Go is not enough** to test the full real app flow. If you run a binary that does not include `expo-sqlite`, you will see the SQLite unavailable fallback or errors such as `Cannot find native module 'ExpoSQLite'`.

For real Android development, use a **development build** or a binary generated with EAS.

## Installation

```bash
bun install
```

## Development commands

### Start Metro

```bash
bun run start
```

Equivalent:

```bash
bunx expo start -c
```

### Open Android from Metro

```bash
bun run android
```

### Open iOS from Metro

```bash
bun run ios
```

### Open Web

```bash
bun run web
```

## Quality and verification

### Lint

```bash
bun run lint
```

### Typecheck

```bash
bun run typecheck
```

Equivalent:

```bash
bunx tsc --noEmit
```

### Tests

```bash
bun run test
```

### Watch tests

```bash
bun run test:watch
```

### Coverage

```bash
bun run test:coverage
```

### Verify failed pre-commit path

```bash
bun run verify:precommit-fail-path
```

## Git hooks

Install local hooks:

```bash
bun run prepare
```

## Database and Drizzle

Drizzle configuration lives in `drizzle.config.ts`, and migrations are generated into `src/infrastructure/db/migrations`.

### Generate migrations

```bash
bunx drizzle-kit generate
```

### Explicit alternative with config

```bash
bunx drizzle-kit generate --config=drizzle.config.ts
```

Note:

Migrations are applied at runtime from `src/app/_layout.tsx` using `SQLiteProvider` and `runMigrations()`.

## Local Android with a native binary

If you want to test real SQLite, local cleartext HTTP, and native wiring, you need a native build.

### Option 1: remote development build with EAS

```bash
eas build --platform android --profile development
```

This is the command we needed documented for this repo.

### Option 2: local preview build with Docker

If you want to generate the APK locally on Windows using Docker Desktop, this repo already includes the required setup in `Dockerfile.eas` and `docker-compose.eas.yml`.

Minimum requirements:

- Docker Desktop with the WSL2 backend enabled
- `EXPO_TOKEN` loaded in `.env.local`

Command:

```bash
docker compose -f docker-compose.eas.yml run --rm eas-build
```

> It use `preview` flag and generates an apk with js bundle included.

Alternative profiles:

```bash
docker compose -f docker-compose.eas.yml run --rm eas-build development
docker compose -f docker-compose.eas.yml run --rm eas-build production
```

> The flag `development` generates a development build that connects with Metro.

Output:

- the APK is written to the project root as `build-*.apk`
- those local artifacts are ignored by Git

### Option 3: remote preview build

```bash
eas build --platform android --profile preview
```

### Option 4: remote production build

```bash
eas build --platform android --profile production
```

## Install and open a development build

After generating the Android development build, install the resulting APK/AAB on the device or emulator and then start Metro:

```bash
bun run start
```

If the development client is already installed, you can open it against the local bundler.

## Submit / deploy

### Send a production build with EAS Submit

```bash
eas submit --platform android --profile production
```

Note:

`eas.json` already defines the `submit.production` section.

## Useful Expo / EAS commands

### Verify resolved public config

```bash
npx expo config --type public
```

### Check dependencies and project health

```bash
npx expo-doctor
```

### Check Expo-recommended upgrades

```bash
npx expo install --check
```

## Suggested development flow

### Daily work without a new native build

```bash
bun install
bun run start
bun run test
bun run typecheck
```

### When native plugins or SQLite change

```bash
eas build --platform android --profile development
```

### Before closing a task

```bash
bun run lint
bun run test
bun run typecheck
```

## Troubleshooting

### Error: `Cannot find native module 'ExpoSQLite'`

Cause:

You are running the app in a binary that does not include native `expo-sqlite`.

This typically happens when:

- you use Expo Go for a flow that requires native SQLite
- you installed an old development client
- you added or changed native plugins and did not regenerate the build

Solution:

```bash
eas build --platform android --profile development
```

Then install the new build on the device or emulator and start Metro:

```bash
bun run start
```

### Network error against a local IP on Android

Symptoms:

- pairing fails against `http://192.168.x.x:port`
- sync fails even though the bridge is running

Possible cause:

Android blocks cleartext HTTP traffic if the binary was not generated with the correct native configuration.

In this repo, that is already declared in `app.json` through `expo-build-properties` with `usesCleartextTraffic: true`, but you still need to rebuild the binary for it to apply.

Solution:

```bash
eas build --platform android --profile development
```

### Reinstall the development client correctly

When you change native plugins, SQLite, permissions, or Android configuration, use this flow:

```bash
eas build --platform android --profile development
```

Then:

1. Uninstall the previous app or development client if it is still using old binaries.
2. Install the new APK/AAB generated by EAS.
3. Start Metro with `bun run start`.
4. Open the installed app and connect it to the local bundler.

### Expo Router warnings about `missing default export`

If you see warnings like these:

```text
Route "./(home)/index.tsx" is missing the required default export
Route "./(tabs)/index.tsx" is missing the required default export
```

Do not assume the export is wrong.

In this project, that warning can be secondary to a crash during module evaluation, especially if an `ExpoSQLite` error also appears. Fix the native issue first.

## Release checklist

### Preview Android

1. Install dependencies:

```bash
bun install
```

2. Verify quality:

```bash
bun run lint
bun run test
bun run typecheck
```

3. Generate the preview build:

```bash
eas build --platform android --profile preview
```

4. Install the build on a device and validate:

- app startup
- setup / pairing
- SQLite access
- sync against the local bridge
- main navigation

### Production Android

1. Install dependencies:

```bash
bun install
```

2. Verify quality:

```bash
bun run lint
bun run test
bun run typecheck
```

3. Generate the production build:

```bash
eas build --platform android --profile production
```

4. Submit for distribution:

```bash
eas submit --platform android --profile production
```

### Minimum checklist before any build

- confirm the change does not require regenerating secrets or credentials outside the repo
- confirm the local bridge is still responding if you touched pairing or sync
- if you changed SQLite, Expo plugins, or Android permissions, use a new build; do not reuse an old development client

## Relevant structure

- `src/app/` — Expo Router routes
- `src/infrastructure/db/` — SQLite client, schema, and Drizzle migrations
- `src/features/` — hooks and business logic
- `tests/` — smoke, unit, and integration-style tests
- `docs/specs/` — project functional specs

## Project references

- `app.json` — Expo configuration and native plugins
- `eas.json` — build and submit profiles
- `drizzle.config.ts` — Drizzle Kit configuration
