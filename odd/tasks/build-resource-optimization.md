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
- [x] T3 C1 + C2 + C3 in the release workflow, plus C7 (mid-task maintainer addition, same file):
  decide how to measure CI without publishing → decided as "measure on the next real release,
  v1.6.1" (no dry runs).
- [x] T4 C7 (native gate off the critical path) done as part of T3, folded in by the maintainer
  since it is the same file. C8 (dropping `x86`/`x86_64`) stays on stand-by by maintainer decision
  — needed for emulator/testing coverage during development; the ABIs were not touched.

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

### T3 — C1 + C2 + C3 + C7 in `.github/workflows/release.yml`

**Job DAG (C7).** Split the old two-job workflow (`guard` → `release`) into four:
`guard` (version/changelog/ancestor guards, `bun install`, typecheck, test, release-notes artifact,
plus the C2 decision) → `native` (Kotlin unit tests + Android lint, C1 + C3) and `build` (the EAS
release build and every artifact guard) in **parallel**, both gated only on `guard` → `publish`
(the only job with `contents: write`; downloads the release-notes and `release-apk` artifacts and
publishes exactly as v1.6.0 did). `native` needs `guard` to have set `native: run` (C2); `build`
always runs. `publish`'s `needs` list is `[guard, build, native]`, not the `[build, native]` first
sketched — GitHub Actions only exposes `needs.<job>.outputs` to jobs that list that job directly,
and `publish` needs `needs.guard.outputs.version` for the APK filename, so `guard` had to be added
explicitly. This changes no timing (`guard` was already a transitive ancestor of both `build` and
`native`), only context access.

**Hardened to fail closed (review finding, fixed same task).** First cut had two fail-open holes:
`native`'s `if: needs.guard.outputs.native == 'run'` would silently SKIP the native gate on any
unexpected `native` output (empty, a renamed output, a step bug) — anything other than the literal
string `'run'` skipped it, including "I don't know". And `publish` accepted
`needs.native.result == 'skipped'` at face value, without checking that the skip was actually the
C2 decision rather than some other cause. Fixed both: `native` now reads
`if: needs.guard.outputs.native != 'skip'` — only an EXPLICIT `skip` skips it, so an unexpected
value runs the gate instead (fail closed the other way: doubt now runs, never skips). `publish`
now reads
`if: ${{ !cancelled() && needs.build.result == 'success' && (needs.native.result == 'success' || (needs.native.result == 'skipped' && needs.guard.outputs.native == 'skip')) }}`
— a `native` skip only counts as safe when `guard.outputs.native` itself says `'skip'`, read
independently rather than inferred from `native.result` alone.

The `!cancelled()` is load-bearing: any custom `if:` that does not call
`always()`/`success()`/`failure()`/`cancelled()` gets an implicit `&& success()` ANDed on by
GitHub Actions, which would refuse to run `publish` whenever `native` was skipped (skipped ≠
succeeded). `native`'s own condition deliberately does **not** call any of those functions, so it
keeps the implicit `&& success()` — meaning `native` only runs when `guard` both succeeded AND its
decision was not an explicit skip, with no extra check needed. Traced every case: native changed +
all green → `native` runs and succeeds, `build` succeeds → publish runs. Native unchanged →
`guard.outputs.native == 'skip'`, `native`'s `if` is false → `native` skipped → publish's
`(native.result == 'skipped' && guard.outputs.native == 'skip')` branch → publish runs. `native`
fails → publish's condition is false on both branches → no publish. `build` fails → publish's
`build.result == 'success'` is false → no publish regardless of `native`. `guard` fails →
`build`/`native` both skip (their default implicit gate) → `build.result` is `'skipped'`, not
`'success'` → no publish. **Empty/unexpected decision output** (`guard.outputs.native` is neither
`'run'` nor `'skip'`, e.g. blank) → `native`'s `!= 'skip'` is true → `native` runs (fails closed by
running, not skipping). **`native` skipped but the decision was not `'skip'`** (only reachable
through `guard` failing, which also skips `build`) → publish's added
`guard.outputs.native == 'skip'` check is false even though `native.result == 'skipped'` → no
publish; this makes publish's own safety independent of `build` also having failed, not merely
coincidental with it.

No checkout in `publish`: it publishes two downloaded artifacts and needs no repository source;
`gh release create`/`gh release view` are told the repo explicitly with `--repo "$GITHUB_REPOSITORY"`
instead of relying on a checked-out git remote.

**C1 (Gradle caching).** `gradle/actions/setup-gradle@9c971963bec38e04b3d30dcc455b5382be2fdbfb`
(v6.3.0) in both `native` and `build`, right after `setup-java`, with `cache-provider: basic` and
`cache-read-only: false` — verified against that exact SHA's `setup-gradle/action.yml` via
`gh api` (not assumed): `cache-provider` defaults to `enhanced` (commercial), `cache-read-only`
defaults to `${{ github.event.repository != null && github.ref_name != github.event.repository.default_branch }}`,
true for any tag push. Distribution + dependency caching in both jobs. The Gradle **build cache**
(`--build-cache`, equivalent to `org.gradle.caching=true`) is appended as a command-line flag
inside `buildGradleTestArgs()` (`scripts/lib/kotlin-tests.mjs`) — scoped to exactly the one Gradle
invocation `native` (and lefthook's local `native` pre-commit job) runs, never touching a shared
`gradle.properties` that could also reach `build`'s own Gradle invocation. It is unconditional
(also on for local pre-commit runs, not gated to CI-only): the debug-variant tests/lint it backs
ship in no release artifact, so there is no reproducibility risk either way. **Not enabled for
`build`** (the release Gradle invocation) — left as an explicit `# Pending measurement` decision in
the workflow comment, since reusing cached task outputs inside the shipped artifact is a separate
question from caching downloads, unmeasured until v1.6.1.

**C2 (skip when nothing native changed).** New `scripts/lib/release-native-gate.mjs` (pure decision:
a small glob matcher for `NATIVE_GATE_WATCHED_GLOBS`, semver-based "previous release tag"
resolution, and the composed run/skip verdict) + `scripts/release-native-gate.mjs` (git plumbing,
fail-safe by construction). Watched paths: exactly the list given in scope —
`modules/**/android/**`, `modules/*/expo-module.config.json`, `plugins/**`, `app.json`, `eas.json`,
`package.json`, `bun.lock`, `scripts/kotlin-unit-tests.mjs`, `scripts/lib/kotlin-tests.mjs`,
`.github/workflows/release.yml`. Previous-tag resolution is by **semantic version order among `v*`
tags**, not git ancestry — a hotfix tagged out of chronological order must not pick the wrong
"previous" release. Fail-safe branches (all return `run`, never `skip`): `GITHUB_REF_NAME` unset,
any git command failing, the current tag unparseable or not found among fetched tags, no earlier
tag to compare against, and two tags tying for "closest earlier" (should not happen given this
repo's own duplicate-version guard, but not trusted blindly). Checkout: `guard` already has
`fetch-depth: 0`, and `actions/checkout`'s own input description confirms `0` fetches "all history
for all branches **and tags**" — no separate `fetch-tags: true` needed, and no cheaper option
would still see every tag. `native`/`build`/`publish` all use the default shallow checkout (depth 1)
since none of them need tag history.

**Risk found and fixed (version-aware exemption).** First cut of C2 watched `app.json` and
`package.json` at whole-file granularity, and this project's own hard rule
(`.claude/skills/mobile-release/SKILL.md` "Hard Rules") is that every release hand-edits
`expo.version` in both files — so C2 would have resolved to `skip` on almost no real release.
Fixed with a version-aware exemption, scoped to EXACTLY those two files
(`VERSION_BUMP_EXEMPT_PATHS` in `scripts/lib/release-native-gate.mjs`): a change to `app.json` or
`package.json` still counts as native-relevant UNLESS every changed line in that file's
`git diff -U0 <previousTag> <currentRef>` is a `"version": "…"` line (`isVersionBumpOnlyDiff`).
Anything else in either file (plugins, Android config, permissions, dependencies, scripts) still
triggers the gate (`excludeVersionOnlyBumps` only drops a matched exempt path when its diff was
classified `true`; missing from the map — the diff could not be read — keeps it, fail-safe).
Diffing happens per-file in the entry point (`scripts/release-native-gate.mjs`'s
`collectVersionOnlyDiffs`/`readVersionOnlyDiff`); a failure reading ONE exempt file's diff fails
safe for that file alone, not the whole decision. Tests: RED first, then GREEN (14 new cases across
`isVersionBumpOnlyDiff`, `excludeVersionOnlyBumps`, and `decideNativeGate` composition), then two
required mutations, both confirmed and restored from the staged index: (1) dropping the exemption
(`excludeVersionOnlyBumps` returns its input unchanged) made the version-only fixture fail (it
reported `run` instead of `skip`); (2) widening the classifier to accept any content line made the
plugins-change fixture fail (it reported `skip` instead of `run`).

**Proven on real history, not just a fixture.** `v1.0.1..v1.1.0`, `v1.1.0..v1.2.0` (checked, not
used below), `v1.2.0..v1.2.1` (checked, not used below), `v1.2.1..v1.2.2`, and `v1.4.0..v1.4.1` are
ALL real release ranges whose diff, restricted to the watched-path scope, touches nothing but
`app.json`'s and `package.json`'s version lines. Re-running the entry script against three of them
now reports `skip`: `GITHUB_REF_NAME=v1.1.0` → `previous=v1.0.1 reason=no_native_paths_changed
decision=skip`; `GITHUB_REF_NAME=v1.2.2` → `previous=v1.2.1 reason=no_native_paths_changed
decision=skip`; `GITHUB_REF_NAME=v1.4.1` → `previous=v1.4.0 reason=no_native_paths_changed
decision=skip`. `v1.6.0` still correctly reports `run` (its `package.json` diff has more than the
version line, per `git diff --stat`, and `modules/**/android/**` changed too) — and its matched-path
log now excludes `app.json` (version-only) while still listing `package.json` (not version-only).
C2 is no longer dead weight: it demonstrably skips on real, already-shipped release ranges.

**C3 (one Gradle invocation).** `buildGradleTestArgs({ withLint })` in `scripts/lib/kotlin-tests.mjs`
appends `:sync-engine:lintDebug` and `:foreground-sync-ticker:lintDebug` to the same argv as the
two `testDebugUnitTest` tasks when `withLint` is true; `scripts/kotlin-unit-tests.mjs` reads
`--with-lint` off `process.argv`. `native`'s workflow step: `bun run test:kotlin -- --with-lint`,
replacing the two former CI steps. lefthook's `native` pre-commit job (`lefthook.yml`) is
unchanged — still tests only, no lint, no behaviour change there.

**Local evidence** (JDK 21 via Android Studio's bundled JBR, `android/` already prebuilt/warm):
`bun run test:kotlin` — `BUILD SUCCESSFUL in 18s`, `138 actionable tasks: 1 executed, 137
up-to-date`. `bun run test:kotlin -- --with-lint`, first run (lint had never run locally) —
`BUILD SUCCESSFUL in 5m 15s`, `244 actionable tasks: 104 executed, 3 from cache, 137 up-to-date`
— one Gradle invocation, one `BUILD SUCCESSFUL`, both `testDebugUnitTest` and `lintDebug` present
for both modules. Same command run again immediately after — `BUILD SUCCESSFUL in 1m 2s`, `244
actionable tasks: 21 executed, 223 up-to-date`. C2 verified against real tags (post version-aware
fix): `GITHUB_REF_NAME=v1.6.0 GITHUB_SHA=<v1.6.0 commit>` → `reason=native_paths_changed
decision=run` (diff against `v1.5.0` matched `modules/**/android/**`, `plugins/**`, both script
files, and `package.json` — `app.json` is correctly excluded from this list now, since its own
diff in that range is version-only, while `package.json`'s is not); `GITHUB_REF_NAME=v1.1.0`,
`v1.2.2`, `v1.4.1` (all real version-only-bump ranges) → `reason=no_native_paths_changed
decision=skip`; `GITHUB_REF_NAME=v1.0.0` (earliest tag) → `reason=no_previous_tag decision=run`;
no `GITHUB_REF_NAME` set → `reason=github_ref_name_missing decision=run`. See
`docs/logbooks/build-performance.md` "Pending measurement" for the full CI-numbers gap this leaves
for v1.6.1.

**Files:** `.github/workflows/release.yml` (4-job DAG), `scripts/lib/release-native-gate.mjs` +
`scripts/release-native-gate.mjs` + `tests/scripts/release-native-gate.test.ts` (new, C2),
`scripts/lib/kotlin-tests.mjs` + `scripts/kotlin-unit-tests.mjs` + `tests/scripts/kotlin-tests.test.ts`
(C1 build-cache flag, C3 `--with-lint`), `docs/logbooks/build-performance.md`,
`.claude/skills/mobile-release/SKILL.md` + `.agents/skills/mobile-release/SKILL.md` (kept
byte-identical), `docs/local-android-build.md`, this file.

