# build-resource-optimization

Feature: reduce wall-clock time AND consumed compute (CPU, memory, I/O, network) of the APK build, in
the local Docker path and in the GitHub Actions release, without weakening any validation or release
guarantee. Every change ships with a before/after measurement.

Status: in progress. Branch: `dev` (after the 1.6.0 release). Follows `faster-docker-apk-build.md`
(Docker ~10 → ~4.5 min, native gates).

Delivery: work-unit commits without per-commit confirmation; push/merge/release need confirmation.
TDD: build configuration; checks are measured builds. Scripts with logic get Jest tests.

## Principle

Parallelism shortens the wait but spends the same compute. Prefer, in order: (1) not doing work that
is redundant or unchanged, (2) reusing work (caches, artifacts), (3) running what remains in parallel.

## Baseline (before)

### GitHub Actions — release v1.6.0 (run `35944890032`, `ubuntu-latest`, 4 vCPU)

| Stage | Time | Notes |
|---|---|---|
| Total | 37m 53s | v1.5.0: 33m, v1.4.0: 31m, v1.4.1: 23m |
| `guard` | 9m 19s | was ~70–90 s; +283 s Kotlin tests, +208 s Android lint (both cold) |
| `release` build step | 28m 08s | Gradle `26m 47s`, `1108 actionable tasks: 1108 executed` (zero reuse) |

Inside the release Gradle run: Gradle 9.0.0 distribution downloaded every run; first task 54 s after
start; task time 1240 s vs 1607 s wall (little parallelism on 4 vCPU); last ~6 min is `:app` CMake run
per ABI in sequence (`armeabi-v7a`, `x86`, `x86_64`); `lintVital*` 244 s of task time; JS bundled twice
(EAS `EAGER_BUNDLE` + Gradle `createBundleReleaseJsAndAssets`). The native gate in `guard` and the
release build each download Gradle and every Maven dependency independently.

### Docker (local, 20 CPUs / ~15.5 GB)

- Warm build before this feature: 4m 16s – 4m 25s total, Gradle 3m 8s, 400 of 1044 tasks from cache.
- `Dockerfile.eas` has two floating inputs: `reactnativecommunity/react-native-android:latest` and the
  Bun installer (latest). A routine `docker compose build` on 2026-09-23 re-pulled the base image
  (91 s of download) and moved Bun 1.3.14 → 1.4.2 and the image 7.35 GB → 6.51 GB, without any repo
  change. The Git-hook invariant was verified on Bun 1.3.14.
- Build context is not a cost: BuildKit transfers 118 B (no `COPY` in the Dockerfile).
- JS bundled twice per build (same as CI).
- New baseline on the refreshed image: see Progress (m0), with `docker stats` peaks.

## Candidate changes, prioritised (impact × cost × risk)

| # | Front | Change | Saves | Risk |
|---|---|---|---|---|
| C1 | CI | Gradle caching (`gradle/actions/setup-gradle`, SHA-pinned) in `guard` and `release`: distribution, dependencies, build cache | network + configuration every run; compile reuse | cache limits, release reproducibility (decide scope) |
| C2 | CI | Skip the native gate when nothing native changed since the previous release tag (path filter incl. `package.json`, `bun.lock`, `app.json`, `plugins/`) | ~8 min compute on JS-only releases | a filter too narrow skips a needed check |
| C3 | CI | Kotlin tests + Android lint in one Gradle invocation | one configuration + daemon | low |
| C4 | Both | `EAS_BUILD_DISABLE_BUNDLE_JAVASCRIPT_STEP=1` (skip the duplicate eager bundle) | ~15–30 s per build | low: Gradle still bundles and fails on JS errors |
| C5 | Docker | Pin the base image by digest and Bun by version | 91 s + GBs of pull on every rebuild; reproducibility | low |
| C6 | Docker | Measure and, if warranted, cap memory/workers (host pressure reaped builds twice) | host stability | slower build if over-capped |
| C7 | CI | Native gate as a parallel job; publish waits for build + gate | ~8 min wall, 0 compute | workflow restructure |
| C8 | CI | Release APK without `x86`/`x86_64` | ~3 min CMake, smaller APK | **product decision** (emulators) |

## Tasks

- [x] T1 Docker baseline on the refreshed image (m0): time, peak memory, CPU (network not observable).
- [x] T2 C5 + the `GRADLE_USER_HOME` fix and guard kept; C4 measured and rejected; C6 not warranted.
- [ ] T3 C1 + C2 + C3 in the release workflow; decide how to measure CI without publishing.
- [ ] T4 C7 if still warranted after T3; C8 only on maintainer decision.

## Progress

### Docker measurements (`lab` profile; `docker stats` every 5 s; network is not observable with
`network_mode: host`, block I/O is not reported reliably under WSL2)

| Run | Change | Total | Gradle | Tasks | Mem peak / avg | CPU avg |
|---|---|---|---|---|---|---|
| m0 | refreshed `:latest` image, nothing else | 14m 30s | 12m 45s | 1072 executed, 0 from cache, lintVital ran (46) | 12.68 / 6.87 GiB | 759 % |
| m1 | C5 + `GRADLE_USER_HOME=/root/.gradle` + fail-loud guard | 6m 23s | 4m 40s | 655 executed, 389 from cache, lintVital skipped | 8.76 / 3.37 GiB | 659 % |
| m2 | m1 repeated (warm) | 6m 52s | 4m 58s | 644 executed, 400 from cache | 8.81 / 3.41 GiB | 719 % |
| m3 | m2 + C4 + `dist/android/` output | 6m 08s | 4m 47s | 644 executed, 400 from cache | 8.78 / 3.46 GiB | 711 % |

The permanent copy of these rows is `docs/logbooks/build-performance.md` (D5–D8).

**C4 rejected.** Eager bundle 18.3 s + Gradle re-bundle 13.5 s from Metro's warm cache (~32 s) became one cold Gradle bundle of 35.1 s: no work saved. The 44 s between m2 and m3 is noise. Reverted for Docker; not applied to CI.

**C6 (memory) not warranted now.** With the cache working, the peak is ~8.8 GiB of 15.5 GiB and the average ~3.4 GiB; the 12.7 GiB peak of m0 came from the cold, lintVital-on build. Revisit only if host pressure returns.

**Open:** the pinned new image is ~2 min slower warm than the old one (D3–D4 vs D6–D8) at the same cache reuse; one sample each cannot separate toolchain from host load.

**Maintainer request, done here:** the APK now lands in `dist/android/autoreas-mobile-<version>-<profile>-<abis>-<UTC timestamp>[-g<commit>].apk` (`/dist/` added to `.easignore`); docs, the release skill (both copies) and `docs/deployment.md` updated.

**Root cause of m0 (regression found by measuring, 2026-09-23).** The refreshed base image sets
`GRADLE_USER_HOME=/opt/gradle-home`. Everything this project puts in `/root/.gradle` — the persistent
`eas_gradle_cache` volume, `org.gradle.caching=true`, the lintVital init script — was bypassed with no
error: every build cold, lintVital back on, Gradle and all Maven dependencies re-downloaded into the
container and thrown away. Fix: `GRADLE_USER_HOME=/root/.gradle` in the compose environment, the base
image pinned by digest (`sha256:d4b8ea07…`), Bun pinned (`BUN_VERSION=1.4.2`), and an entrypoint guard
that exits 1 when Gradle would not see `docker/gradle/` (verified both ways: pass prints the Gradle
home; a wrong `GRADLE_USER_HOME` exits 1 before installing anything).

Findings for CI (verified in `gradle/actions` v6.3.0 `setup-gradle/action.yml`): the default
`cache-provider` is `enhanced`, a commercial service — use `basic` (GitHub Actions cache);
`cache-read-only` defaults to `true` on any ref other than the default branch, so a tag-only release
workflow would never write its cache — set it to `false`. The repository is public: standard runner
minutes are not billed, so compute savings buy time and capacity, not money.

