# Build performance logbook

Measured cost of building the Android APK: the local Docker build
([Local Android build](../local-android-build.md)) and the CI release (`.github/workflows/release.yml`).
Append a row whenever the build, its image, its toolchain or its caching changes. See
[Logbooks](README.md) for the rules.

**Latest reference points**

| Build | Warm total | Where it goes |
| --- | --- | --- |
| Local Docker, `lab`, `arm64-v8a` | ~6–7 min on the image pinned 2026-09-23 | Gradle ~75 %; memory peak ~8.8 GiB |
| CI release v1.6.0 | 37m 53s | `guard` 9m 19s (native gate 8 min of it), Gradle 26m 47s with zero reuse |

---

## Method

### Local Docker build

Run the build detached so a session or shell ending does not kill it, sample resources every 5 s,
and read times from the container's own timestamps:

```bash
docker compose -f docker-compose.eas.yml run -d --name perf eas-build lab
while docker inspect -f '{{.State.Running}}' perf | grep -q true; do
  docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' perf >> perf-stats.txt; sleep 5
done
docker logs -t perf | grep -E 'BUILD SUCCESSFUL in|actionable tasks|Build complete'
docker logs -t perf | head -1        # start time; total = "Build complete" time minus this
docker rm perf
```

- **Total** is container start to the `--- Build complete` line.
- **Gradle** is `BUILD SUCCESSFUL in …`; **Tasks** is the `actionable tasks` line (`executed`,
  `from cache`).
- **Memory peak / average** and **CPU average** come from the `docker stats` samples (CPU is in
  percent of one core, so 800 % is eight cores busy).
- Network is **not observable** (`network_mode: host`), and block I/O is not reported reliably under
  WSL2; neither is recorded.
- Machine: 20 CPUs and ~15.5 GB allotted to Docker (WSL2), Windows 11.

### CI release

```bash
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \((.completedAt|fromdate)-(.startedAt|fromdate))s"'
gh run view <run-id> --log --job <job-id> | grep -E 'BUILD SUCCESSFUL in|actionable tasks'
```

Runner: GitHub-hosted, 4 vCPU. The repository is public, so standard runner minutes are not billed.

---

## Local Docker build

| # | Date | Commit | Configuration | Total | Gradle | Tasks | Mem peak / avg | CPU avg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | 2026-09-23 | `ac18acb` | Original: four ABIs, lintVital, no build cache (image of 2026-05) | 10m 15s | 8m 55s | 1108 executed | — | — |
| D2 | 2026-09-23 | `f344a07` | `arm64-v8a` only, Gradle build cache, no lintVital, no expo-doctor — empty cache | 5m 26s | 4m 13s | 911 executed, 133 from cache | — | — |
| D3 | 2026-09-23 | `f344a07` | Same as D2, warm cache | 4m 25s | 3m 08s | 644 executed, 400 from cache | — | — |
| D4 | 2026-09-23 | `f344a07` | Same as D3 (repeat) | 4m 16s | ~3m | 644 executed, 400 from cache | — | — |
| D5 | 2026-09-23 | `2de5917` | **Base image re-pulled from `:latest`**, nothing else changed | 14m 30s | 12m 45s | 1072 executed, **0 from cache**, lintVital ran | 12.68 / 6.87 GiB | 759 % |
| D6 | 2026-09-23 | `2de5917` + working tree | D5 + `GRADLE_USER_HOME=/root/.gradle`, image pinned by digest, Bun pinned, Gradle-home guard | 6m 23s | 4m 40s | 655 executed, 389 from cache | 8.76 / 3.37 GiB | 659 % |
| D7 | 2026-09-23 | same as D6 | Same as D6, warm | 6m 52s | 4m 58s | 644 executed, 400 from cache | 8.81 / 3.41 GiB | 719 % |
| D8 | 2026-09-23 | same as D6 | D7 + skip EAS eager bundle + output in `dist/android/` | 6m 08s | 4m 47s | 644 executed, 400 from cache | 8.78 / 3.46 GiB | 711 % |

**Reading the rows**

- **D5 was a regression with no repository change.** The re-pulled image sets
  `GRADLE_USER_HOME=/opt/gradle-home`, so the cache volume, the build-cache switch and the lintVital
  init script (all under `/root/.gradle`) stopped applying without any error. D6 fixed it and
  added a guard that makes the build fail instead of silently running cold.
- **D8's eager-bundle skip saved nothing.** Before it, EAS bundled the JS in 18.3 s and Gradle
  re-bundled in 13.5 s from Metro's warm cache (~32 s together); without it, Gradle bundled once from
  a cold cache in 35.1 s. The 44 s between D7 and D8 is noise, not the change; the skip was reverted.
  The `dist/android/` output kept.
- **Open: D6–D8 (new image) are ~2 min slower than D3–D4 (old image)** with the same cache reuse
  (400 from cache). One sample per configuration cannot separate the new toolchain (JDK 17.0.20,
  NDK 27.1.12297006, build-tools 37.0.0) from load on the host. Measure again before attributing it.

## CI release

| # | Date | Release | Run | Total | `guard` | Build step | Gradle | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | 2026-09-22 | v1.4.0 | `35670839702` | 31m | 89 s | 29m 07s | — | |
| C2 | 2026-09-22 | v1.4.1 | `35690580176` | 23m | 85 s | 21m 53s | — | |
| C3 | 2026-09-22 | v1.5.0 | `35781239094` | 33m | 70 s | 31m 31s | — | |
| C4 | 2026-09-24 | v1.6.0 | `35944890032` | 37m 53s | 9m 19s | 28m 08s | 26m 47s, 1108 executed | `guard` gained the native gate: Kotlin tests 283 s + Android lint 208 s, cold, serial before the build |

**Reading C4** (from its Gradle log): the Gradle distribution is downloaded on every run and every
Maven dependency is resolved from scratch, separately in `guard` and in the build; the first task
starts 54 s in; summed task time is 1240 s against 1607 s of wall time, so a 4-vCPU runner barely
parallelises; the last ~6 minutes are the app's CMake builds for `armeabi-v7a`, `x86` and `x86_64`,
one after the other; `lintVital` accounts for 244 s of task time.

### Pending measurement — C1 + C2 + C3 + C7, next real release (v1.6.1)

No CI run exists yet for C1–C3 and C7 (`.github/workflows/release.yml`); the maintainer decided
CI changes are measured on the next real release, not with extra dry runs (see
`odd/tasks/build-resource-optimization.md`, T3). **v1.6.1 must record:**

- **Job DAG (C7):** whether `guard` now finishes in about a minute (the Kotlin gate moved out of
  it), the wall-clock overlap between the new parallel `native` and `build` jobs, and whether
  `publish` correctly waited on both and ran once `build` succeeded and `native` either succeeded
  or was skipped.
- **C2 decision:** the `native` output `guard` reported (`run`/`skip`) and why (the tag compared
  against, and whether any watched path matched). `app.json`/`package.json`'s version bump alone no
  longer forces `run`: `scripts/lib/release-native-gate.mjs`'s version-aware exemption
  (`isVersionBumpOnlyDiff`) already reports `skip` for three real past ranges with no other
  native-relevant change (`v1.0.1..v1.1.0`, `v1.2.1..v1.2.2`, `v1.4.0..v1.4.1`) — whether v1.6.1
  itself gets `run` or `skip` now depends on whether v1.6.1 touches anything under the watched-path
  list besides the version bump, not on the version bump itself.
- **C1 caching:** the `native` and `build` jobs' own Gradle summaries (`from cache` counts, whether
  `setup-gradle`'s job summary reports a cache hit) compared to C4's zero-reuse baseline; whether
  `cache-provider: basic` actually persisted a GitHub Actions cache entry across this run and the
  next one.
- **C3 merge:** `native`'s single Gradle invocation time (test + lint together) against C4's
  283 s + 208 s serial baseline.
- **Rows to compare against C4:** `guard` total, `native` total (new), `build`/release-build total,
  `publish` total, and the workflow's overall wall clock from tag push to published release.

Local evidence gathered instead (this repo, JDK 21 via Android Studio's bundled JBR, warm
`android/` project already prebuilt): `bun run test:kotlin` (no lint) — `BUILD SUCCESSFUL in 18s`,
`138 actionable tasks: 1 executed, 137 up-to-date`; `bun run test:kotlin -- --with-lint`, first run
after lint had never run locally — `BUILD SUCCESSFUL in 5m 15s`, `244 actionable tasks: 104
executed, 3 from cache, 137 up-to-date`; the same command run again immediately after — `BUILD
SUCCESSFUL in 1m 2s`, `244 actionable tasks: 21 executed, 223 up-to-date`. All three are one Gradle
invocation each (C3): the lint tasks (`:sync-engine:lintDebug`, `:foreground-sync-ticker:lintDebug`)
ran alongside `testDebugUnitTest` for both modules in the same `BUILD SUCCESSFUL`, never a second
invocation. These numbers are local-machine, warm-cache signal only — not a substitute for the
CI row above, which needs a real cold runner and the shared GitHub Actions cache.
