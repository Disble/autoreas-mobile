# faster-docker-apk-build

Feature: cut the local Docker APK build (`docker compose -f docker-compose.eas.yml run --rm eas-build
<profile>`) from ~30 min to under 10 min, without changing what CI releases.

Status: T1–T4 done. Branch `build/faster-docker-apk`, first cut from `dev` at `ac18acb`, then moved on top
of `fix/native-foreground-sync-service` (`3452620`): `dev` fails the fallow gate on a file that feature
deletes, and T5–T6 need its Kotlin test harness. Worktree
`autoreas-mobile-worktrees/faster-docker-build` (the main checkout is busy with
`native-foreground-sync-service`).

Delivery strategy: `single-pr` (no PR process; local merge to `main`). Work-unit commits without
per-commit confirmation (maintainer, 2026-09-23); push/merge/release still need confirmation.

TDD: this work is build configuration, not app behaviour. Checks are measured builds (wall time per
phase from `docker logs -t`) plus an installable APK; JS tests only if a script with logic is added.

## Goal

A warm local Docker build of the `lab`/`preview` profile finishes in < 10 min wall time on this
machine (20 CPUs / ~15.5 GB for Docker), and the APK installs and runs on the tablet (`arm64-v8a`).

## Constraints

- CI (`release.yml`) and EAS cloud builds keep producing the same universal APK: every speed-up
  lives in the Docker path (`docker-compose.eas.yml`, `Dockerfile.eas`, files mounted only there),
  never in `app.json` / `eas.json` defaults that CI reads.
- Keep the Git-hook invariant (`CI=true`, no `prepare`, `trustedDependencies`).
- Keep the retry loop's intent, but a build whose attempts all fail must exit non-zero.

## Baseline evidence

- Previous `lab` build log (2026-09-23): Gradle `BUILD SUCCESSFUL in 9m 12s`, `1108 actionable
  tasks: 1108 executed` (zero reuse between builds), CMake for four ABIs (`arm64-v8a`,
  `armeabi-v7a`, `x86`, `x86_64`), `lintVitalAnalyzeRelease` in every module (up to 34.5 s each).
- Defect found: the entrypoint's `for attempt in 1 2 3; do … && break; done && echo 'Build complete'`
  prints "Build complete" and exits 0 after three failed attempts (observed 2026-09-23 in a worktree,
  where EAS failed on the missing Git root).
- Worktrees: inside the container `.git` is a file pointing at a Windows path, so EAS needs
  `EAS_NO_VCS=1` (file selection already comes from `.easignore`).
- Verified switches in `@expo/build-tools` / the local build plugin: `EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP`
  (`common/setup.js:134`), `EAS_LOCAL_BUILD_WORKINGDIR`, `EAS_LOCAL_BUILD_SKIP_CLEANUP`.

## Tasks

- [x] T1 Timed baseline (per-phase wall time) of the current setup.
- [x] T2 Apply Docker-only speed-ups, measured one build at a time.
- [x] T3 Fix the entrypoint so a failed build exits non-zero; worktree support (`EAS_NO_VCS`).
- [x] T4 Verify the APK (ABIs, signature); document the new timings in `docs/build-and-release.md`.
  Install on the tablet deferred: this branch is cut from `dev` and would replace the
  `native-foreground-sync-service` build under test there.

## Progress

Measured with `docker logs -t` (container start to `Build complete`), `lab` profile, warm Bun
volume, 20 CPUs / ~15.5 GB for Docker:

| Run | Total | Gradle | Tasks |
|---|---|---|---|
| Baseline (current `dev` setup) | 10 m 15 s | 8 m 55 s | 1108 executed |
| Speed-ups, empty build cache | 5 m 26 s | 4 m 13 s | 911 executed, 133 from cache |
| Speed-ups, warm build cache | 4 m 25 s | 3 m 8 s | 644 executed, 400 from cache |
| Same + `.easignore` change | 4 m 16 s | ~3 m | 644 executed, 400 from cache |

The ~30 min the maintainer saw was not reproduced on a warm, unpressured machine: Gradle is 88 % of
the baseline and the rest is ~76 s. Those runs coincided with host memory pressure (two builds were
reaped while the session was idle).

Changes (all Docker-only; CI's `release.yml` runs `eas build --local` on the runner):
- `ORG_GRADLE_PROJECT_reactNativeArchitectures=${AUTOREAS_ANDROID_ABIS:-arm64-v8a}` — CMake for one
  ABI (only `expo-updates` ignores it). APK 138 MB → 59 MB, only `lib/arm64-v8a/`.
- `docker/gradle/gradle.properties` (`org.gradle.caching=true`) mounted as Gradle user-home
  properties over the persistent cache volume.
- `docker/gradle/init.d/skip-lint-vital.init.gradle` disables `lintVital*` (verified `SKIPPED`).
- `EAS_BUILD_DISABLE_EXPO_DOCTOR_STEP=1`, `EAS_NO_VCS=1` (worktree builds).
- `.easignore` excludes `/android/`, `/ios/`, `build-*.apk`.
- Entrypoint: three failed attempts now exit 1 with `--- Build FAILED after 3 attempts ---`
  (verified with an unknown profile: `exit=1`).
- `mobile-release` skill (both copies): Path B warns that the container builds one ABI without
  lintVital and gives the universal-ABI command for a release rehearsal.

Evidence: APK signed with the same certificate as the installed build
(`10a18376…6b8b7d`, `apksigner verify`); Git hooks of the main checkout untouched after four builds.

Next: T5–T6.

## Native gates (added 2026-09-23, maintainer request)

Linters and tests run before the build, never inside it. The Docker build only skips checks that
no earlier gate repeats locally; `lintVital` stays in the release build because it is the only
check over native code, and the new Kotlin unit tests ran in no gate at all.

- [ ] T5 Lefthook runs the Kotlin unit tests when files under `modules/*/android/**` are staged,
  preparing `android/` with a prebuild when it is missing or stale.
- [ ] T6 Release CI runs the Kotlin unit tests and Android lint in `guard`, before the build job.
