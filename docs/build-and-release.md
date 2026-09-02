# Build and release

Everything about producing an installable binary of Autoreas Mobile, and the invariants that keep
the build environment from damaging your working copy.

> Back to the [README](../README.md).

---

## Git hooks

Hooks install themselves on a fresh `bun install`, via Lefthook's own `postinstall`. Two settings
make that work, and **both are load-bearing**:

| Setting | File | Why |
| --- | --- | --- |
| `trustedDependencies: ["lefthook"]` | `package.json` | Bun blocks dependency lifecycle scripts by default. Without this entry Lefthook's `postinstall` never runs and **no hooks are installed at all**. |
| no `prepare` script | `package.json` | A `prepare: lefthook install` calls the binary directly, and the binary ignores `CI`. Only Lefthook's `postinstall` honours `CI`, so an explicit `prepare` re-opens the Docker bug below. |

`bun install` only installs hooks when it actually (re)installs packages. If hooks go missing on an
already-installed tree, repair them explicitly:

```bash
npx lefthook install
```

### Hooks look wrong after a Docker build

**Symptom:** `git commit` behaves oddly, or `.git/hooks/pre-commit` references a Linux path such as
`/tmp/root/eas-build-local-nodejs/.../lefthook-linux-x64/bin/lefthook` on a Windows machine.

**Cause:** the EAS container bind-mounts the project at `- .:/app`, and a bind mount always includes
`.git`. Listing `.git` in `.dockerignore` does **not** help — that file only filters the
`docker build` context, never a runtime mount. `docker-compose.eas.yml` therefore sets `CI=true`
so Lefthook's postinstall skips hook installation inside the container.

**Repair** an already-clobbered checkout with `npx lefthook install`, then verify:

```bash
npx lefthook version   # should match the version in package.json
```

> A clobbered hook fails **open**: its last fallback echoes "Can't find lefthook in PATH" and exits
> 0, so every gate silently stops running while still reporting success. See the
> [postmortem](postmortems/2026-08-08-eas-container-rewrote-host-git-hooks.md).

---

## Native builds

Testing real SQLite, local cleartext HTTP, and native wiring requires a native build. Plain Expo Go
cannot run this app end to end.

### Option 1 — remote development build with EAS

```bash
bunx eas-cli build --platform android --profile development
```

### Option 2 — local preview build with Docker

To generate the APK locally on Windows with Docker Desktop, this repo already includes the required
setup in `Dockerfile.eas` and `docker-compose.eas.yml`. The container installs dependencies from
`bun.lock` with `bun install --frozen-lockfile`.

> [!WARNING]
> **The container shares your `.git`.** The `- .:/app` mount is not filtered by `.dockerignore`, so
> anything the container writes under `.git/` lands in your real repository. That is why `CI=true`
> is set in `docker-compose.eas.yml` — without it, `bun install` regenerates your Windows Git hooks
> with Linux paths. See [Git hooks](#git-hooks).

**Minimum requirements**

- Docker Desktop with the WSL2 backend enabled
- `EXPO_TOKEN` loaded in `.env.local`

The profile is passed as the last argument; it defaults to `preview` when omitted.

```bash
# Preview (default) — self-contained APK with the JS bundle included
docker compose -f docker-compose.eas.yml run --rm eas-build

# Development — APK that connects to Metro on your machine instead of bundling the JS
docker compose -f docker-compose.eas.yml run --rm eas-build development

# Production — optimized, self-contained APK
docker compose -f docker-compose.eas.yml run --rm eas-build production
```

For the development profile: install the APK, start Metro with `bun run start`, then open the app so
it attaches to the local bundler.

**Output**

- the APK is written to the project root as `build-*.apk`
- those local artifacts are ignored by Git
- the managed prebuild sets Gradle JVM memory to `-Xmx2g` with a `1g` metaspace limit through
  `plugins/withAndroidGradleMemory.js`; no generated `android/` project is tracked

### Option 3 — remote preview build

```bash
bunx eas-cli build --platform android --profile preview
```

### Option 4 — remote production build

```bash
bunx eas-cli build --platform android --profile production
```

### Install and open a development build

After generating the Android development build, install the resulting APK/AAB on the device or
emulator, then start Metro:

```bash
bun run start
```

If the development client is already installed, open it against the local bundler.

---

## Known toolchain notes

**Gradle 10 deprecation notice.** Expo SDK 55 / React Native generated build tooling can emit a
Gradle 10 deprecation warning during the local build. This repository has no root Android Gradle
project and no project-owned deprecated Gradle API to change; keep the toolchain-managed warning
visible until Expo or React Native removes it.

**Native dependency compatibility.**

- `react-native-notify-kit` replaces `@notifee/react-native`, whose repository was archived on
  2026-04-07 and whose native module depends on the legacy Bridge that React Native 0.84 removes.
  The fork keeps the public API and the `app.notifee.core.ForegroundService` class name, but is New
  Architecture only and no longer hardcodes `android:foregroundServiceType` —
  `plugins/withAndroidForegroundSync.js` supplies it. Its native notification and foreground-service
  integration must still be exercised in a preview APK before an Expo or React Native upgrade.
- `foreground-sync-ticker` is a repository-owned Android-only Expo module, so it has no React Native
  Directory entry. It loads through `expo-modules-core`; Android preview builds remain the
  compatibility check for this local native boundary.

---

## Submit and distribute

```bash
bunx eas-cli submit --platform android --profile production
```

`eas.json` already defines the `submit.production` section.

---

## Useful Expo / EAS commands

```bash
bunx expo config --type public   # verify the resolved public config
bunx expo-doctor                 # check dependencies and project health
bunx expo install --check        # check Expo-recommended upgrades
```

---

## Suggested development flow

**Daily work, no new native build**

```bash
bun install
bun run start
bun run test
bun run typecheck
```

**When native plugins or SQLite change**

```bash
bunx eas-cli build --platform android --profile development
```

**Before closing a task**

```bash
bun run validate   # lint + typecheck + test
```

---

## Release checklists

### Preview Android

1. Install dependencies: `bun install`
2. Verify quality: `bun run validate`
3. Generate the preview build:

   ```bash
   bunx eas-cli build --platform android --profile preview
   ```

4. Install on a device and validate:
   - app startup
   - setup / pairing
   - SQLite access
   - sync against the local Bridge
   - main navigation

### Production Android

1. Install dependencies: `bun install`
2. Verify quality: `bun run validate`
3. Generate the production build:

   ```bash
   bunx eas-cli build --platform android --profile production
   ```

4. Submit for distribution:

   ```bash
   bunx eas-cli submit --platform android --profile production
   ```

### Minimum checklist before any build

- confirm the change does not require regenerating secrets or credentials outside the repo
- confirm the local Bridge is still responding if you touched pairing or sync
- if you changed SQLite, Expo plugins, or Android permissions, produce a new build — do not reuse an
  old development client
