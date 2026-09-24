# Local Android build with Docker

Produces an installable Android APK on your own machine, without publishing anything or touching
CI. Use it to smoke-test a change, rehearse a release, or get an emulator-installable build —
anyone who needs an APK before tagging a release. A warm build takes about **4.5 minutes**; the
first build after a cache-clear takes about **5.5 minutes**; before the Docker-only speed-ups this
page documents, the same build took about **10 minutes**. All three numbers are measured on this repo's
reference machine (20 CPUs / ~15.5 GB allotted to Docker), `lab` profile, `docker logs -t`
start-to-finish.

> Back to the [README](../README.md) · Full release procedure in
> [Build and release](build-and-release.md) · Shipping a tagged release: [Deployment](deployment.md).

---

## Quick start

**Prerequisites**

- [ ] Docker Desktop with the WSL2 backend enabled
- [ ] `.env.local` at the repo root with `EXPO_TOKEN` set (see `docs/build-and-release.md` for the
  full list of secrets this file can carry)

**Build**

```bash
docker compose -f docker-compose.eas.yml run --rm eas-build
```

**Install**

```bash
adb install -r build-*.apk
```

**Expect:** an APK named `build-<timestamp>.apk` appears in the repo root, built for `arm64-v8a`
only (the default — see [Which ABI do I need?](#which-abi-do-i-need) if your device or emulator
is not `arm64-v8a`), and installs and opens like any other Android app. This is a managed (CNG)
project: EAS runs its own prebuild, no `android/` project is tracked in Git, and the prebuild
already sets Gradle JVM memory to `-Xmx2g` with a `1g` metaspace limit through
`plugins/withAndroidGradleMemory.js`.

---

## Profiles

The profile is the last argument; it defaults to `preview` when omitted.

```bash
docker compose -f docker-compose.eas.yml run --rm eas-build <profile>
```

| Profile | Produces | Use it for |
| --- | --- | --- |
| `preview` (default) | Self-contained APK, JS bundle included | The everyday local build |
| `development` | APK that connects to Metro on your machine instead of bundling the JS | Iterating on JS while testing native code |
| `production` | Self-contained APK, optimized | Release rehearsal before tagging (see [Recipes](#recipes)) |
| `lab` | Self-contained APK, `android:debuggable="true"` (via `plugins/withAndroidLabDebuggable.js`) | Inspecting the app from outside with `adb shell run-as`; **never distribute this build** |

> [!WARNING]
> **`production` only emits an APK because `eas.json` sets `production.android.buildType: "apk"`.**
> Without that key EAS falls back to `:app:bundleRelease`, which produces an **AAB** — a file that
> cannot be sideloaded. Never trust the file extension alone:
> ```bash
> unzip -l build-*.apk | grep -q BundleConfig.pb && echo "this is an AAB"
> ```

For the `development` profile: install the APK, start Metro with `bun run start`, then open the app
so it attaches to the local bundler.

---

## Configuration reference

Set through one of the mechanisms in the **Where** column; see
[Which source wins?](#which-source-wins) for precedence when more than one is set at once.

| Option | Default | Accepted values | Where | Example |
| --- | --- | --- | --- | --- |
| `AUTOREAS_ANDROID_ABIS` | `arm64-v8a` | Comma-separated list from `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` | `.env.local` (persistent) · a bare shell export for one run · `docker compose run -e` | `AUTOREAS_ANDROID_ABIS=x86_64` |
| profile (positional argument) | `preview` | `preview`, `development`, `production`, `lab` | Last argument to `docker compose ... run --rm eas-build <profile>` | `... eas-build production` |
| `AUTOREAS_DRY_RUN` | unset (off) | `1` to enable | A bare shell export or `docker compose run -e` | `AUTOREAS_DRY_RUN=1 docker compose -f docker-compose.eas.yml run --rm eas-build` |

`AUTOREAS_DRY_RUN=1` prints the resolved ABI line and exits immediately — no `bun install`, no EAS
build. Use it to check what a change to `.env.local` or a shell export will resolve to, in under a
second, without paying for a 5-minute build.

**Fixed settings.** These are already correct in `docker-compose.eas.yml`; know what they do, but
do not change them:

| Setting | Why |
| --- | --- |
| `CI=true` | Stops `bun install` inside the container from regenerating the **host's** Git hooks with Linux paths (the container bind-mounts `.git`). See [Git hooks](build-and-release.md#git-hooks) and the [postmortem](postmortems/2026-08-08-eas-container-rewrote-host-git-hooks.md). |
| `EAS_NO_VCS=1` | Lets the build run from a Git worktree, where `.git` is a file pointing at a path the container cannot resolve. File selection then comes entirely from `.easignore`. |
| `EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP=1` | `expo-doctor` exits 1 on this project and EAS ignores the result anyway; skipping it saves a few seconds. |
| `docker/gradle/gradle.properties`, `docker/gradle/init.d/skip-lint-vital.init.gradle` (mounted read-only over `/root/.gradle`) | Turn on the Gradle build cache and turn off `lintVital*` — Docker-build-only, never applied to a CI release build. |
| `_JAVA_OPTIONS=-Djava.net.preferIPv4Stack=true ...` | Works around a Docker Desktop on Windows IPv6/DNS issue that otherwise breaks every Gradle dependency download. |
| `network_mode: host` | The container shares the Windows/WSL2 network stack directly, avoiding a second layer of DNS issues. |

### Which ABI do I need?

Check a physical device with `adb shell getprop ro.product.cpu.abilist`.

| Target | ABI |
| --- | --- |
| Physical phone or tablet | `arm64-v8a` (the default — nothing to set) |
| Android Studio emulator on an Intel/AMD PC | `x86_64` |
| Android Studio emulator on Apple Silicon | `arm64-v8a` |
| Old 32-bit device | `armeabi-v7a` |
| Release rehearsal, or sharing with testers of unknown devices | All four: `armeabi-v7a,arm64-v8a,x86,x86_64` |

### Which source wins?

Highest precedence first, when more than one is set for the same build:

1. A one-off `AUTOREAS_ANDROID_ABIS=... docker compose ... run ...` shell export, **or**
   `docker compose run -e AUTOREAS_ANDROID_ABIS=...` — either form beats `.env.local`. Do not
   combine both at once in the same invocation: if you do, the shell export wins.
2. `AUTOREAS_ANDROID_ABIS` in `.env.local` — your persistent, per-machine default.
3. `arm64-v8a` — the built-in default, if nothing above sets a value.

This is resolved **inside the container**, by `docker/eas-build-entrypoint.sh`, specifically
because `docker compose` itself cannot do it correctly: `docker-compose.eas.yml` is interpolated by
`${VAR}` substitution on the **host**, at `docker compose` parse time, using the calling shell's
environment — never `.env.local`, which is only loaded into the *container's* environment once it
starts. A naive `${AUTOREAS_ANDROID_ABIS:-arm64-v8a}` directly in the compose file's `environment:`
section therefore silently ignored `.env.local` and always fell back to the default.

The entrypoint also validates the resolved value before starting anything: every comma-separated
item must be one of the four accepted ABIs (trimmed, no empty items), or the build exits within a
second with a clear error — see [Troubleshooting](#troubleshooting).

---

## How it works

Gradle is roughly **90%** of the build; the rest — EAS setup, `bun install`, prebuild, JS
bundling — is about a minute.

**What persists between builds** (named Docker volumes, shared across every project on the
machine):

| Volume | Mounted at | Holds |
| --- | --- | --- |
| `eas_gradle_cache` | `/root/.gradle` | Gradle downloads and the build cache (`org.gradle.caching=true`, via the read-only mounted `gradle.properties`) |
| `eas_android_cache` | `/root/.android` | Android SDK/NDK extras, so they are not re-downloaded |
| `eas_bun_cache` | `/root/.bun/install/cache` | Bun package downloads and Bunx CLI resolution |
| `node_modules` (project-scoped) | `/app/node_modules` | Linux-native `node_modules`, isolated from the Windows host tree |

**Why EAS starts fresh every time anyway:** the EAS local-build tooling extracts the project into a
brand-new working directory on every invocation, so Gradle's own incremental build state (task
up-to-date checks against unchanged inputs) never survives from one build to the next — the
baseline measurement showed `1108 actionable tasks: 1108 executed`, zero reuse. The Gradle **build
cache** in `eas_gradle_cache` is what recovers most of that: it caches cacheable task *outputs*
(compilation, dexing, resource merging) independently of the working directory they ran in, so a
later build can reuse them even though every input file was freshly extracted.

---

## Local build vs. CI release build

Do not mistake a local APK for a release artifact. They differ on purpose:

| | Local Docker build | CI release build (`release.yml`) |
| --- | --- | --- |
| Native ABIs | `arm64-v8a` only, by default (configurable) | All four — CI never sets `AUTOREAS_ANDROID_ABIS`, so nothing narrows the build |
| `lintVitalAnalyzeRelease` | Disabled (`skip-lint-vital.init.gradle`) | Runs, fatal issues only |
| `expo-doctor` | Disabled | Not disabled (also ignored by EAS either way) |
| Kotlin unit tests + lint | Pre-commit hook only (`native` job, when `modules/*/android/**` is staged) | CI `guard` job, every push of a release tag |
| JS lint / typecheck / tests | Pre-commit hook | CI `guard` job |
| eas-cli version | Floats on `@latest` | Pinned (`eas-cli@23.2.0` at the time of writing) |
| Signing | EAS-managed remote keystore (same as CI) | EAS-managed remote keystore |
| Where it ships | Nowhere — local artifact only, gitignored | A published GitHub Release |

---

## Recipes

**Build for an emulator on an Intel/AMD PC**

```bash
AUTOREAS_ANDROID_ABIS=x86_64 docker compose -f docker-compose.eas.yml run --rm eas-build
```

**Build a universal APK (all four ABIs)**

```bash
AUTOREAS_ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 docker compose -f docker-compose.eas.yml run --rm eas-build production
```

**Release rehearsal** — matches what CI ships as closely as a local build can (still no lintVital):

```bash
AUTOREAS_ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 docker compose -f docker-compose.eas.yml run --rm eas-build production
```

**Build from a Git worktree**

Nothing extra to do — `EAS_NO_VCS=1` is always set, so file selection comes from `.easignore`
instead of Git regardless of whether `.git` is a real directory or a worktree's `.git` file.

**Clear the Gradle cache**

Only needed if you suspect the cache itself is corrupted, or you want a clean timing measurement:

```bash
docker volume rm eas_gradle_cache
```

**Rebuild the image after changing `Dockerfile.eas`**

```bash
docker compose -f docker-compose.eas.yml build eas-build
```

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `INSTALL_FAILED_NO_MATCHING_ABIS` | The APK was built for an ABI your device/emulator does not support (default is `arm64-v8a` only) | Rebuild with the right `AUTOREAS_ANDROID_ABIS` — see [Which ABI do I need?](#which-abi-do-i-need); check your device with `adb shell getprop ro.product.cpu.abilist` |
| `--- Build FAILED after 3 attempts. No APK was produced. ---` | All three build attempts failed — a real error, not a fluke | Scroll up to the last attempt's own error; the message before this line is the actual cause (network hiccup, a real compile/lint error, EAS API failure) |
| `--- Invalid AUTOREAS_ANDROID_ABIS value: '...' ---` | A typo or malformed value (unknown ABI, empty item, trailing comma) in `.env.local` or a shell export | Fix the value to a comma-separated list of `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` |
| `Failed to get Git root path` warning | Building from a worktree, where `.git` is a file the container cannot resolve as a repo | Harmless — `EAS_NO_VCS=1` already routes file selection through `.easignore` instead |
| `expo-doctor` exits 1 / is mentioned in logs | `expo-doctor` flags something on this project | Expected and intentionally skipped locally (`EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP=1`); EAS ignores its result on every build regardless |
| Host Git hooks rewritten with Linux paths (e.g. `.../lefthook-linux-x64/bin/lefthook`) | `CI=true` was removed, or `trustedDependencies`/no-`prepare` invariant was broken | Repair with `npx lefthook install`; see [Git hooks](build-and-release.md#git-hooks) and the [postmortem](postmortems/2026-08-08-eas-container-rewrote-host-git-hooks.md) |
| Build killed partway, or extremely slow | Docker Desktop's memory/CPU allocation is too low for a Gradle build | Raise the resource limits in Docker Desktop settings (or `.wslconfig` for WSL2); Gradle needs headroom on top of the emulator/IDE you may also have open |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed app was signed with a different key than the new APK (e.g. switching between a local build and a CI-signed release) | **Do not uninstall without warning yourself first** — uninstalling deletes the app's local data (SQLite catalogue, pairing). Back up or accept the loss deliberately, then uninstall and reinstall. |

---

## References

- `docker-compose.eas.yml` — the service definition: volumes, fixed environment, `env_file`.
- `docker/eas-build-entrypoint.sh` — ABI resolution, validation, dependency install, the retry loop.
- `Dockerfile.eas` — the build image (Java/Android SDK/NDK/CMake/Gradle, Bun).
- `docker/gradle/gradle.properties`, `docker/gradle/init.d/skip-lint-vital.init.gradle` — the two
  Docker-only Gradle speed-ups.
- `.easignore` — file selection when `EAS_NO_VCS=1` bypasses Git.
- `eas.json` — profile definitions.
- `plugins/withAndroidLabDebuggable.js` — what makes the `lab` profile debuggable, and why it needs
  its own lint suppression.
- [Build and release](build-and-release.md) — the full release procedure this local build rehearses.
