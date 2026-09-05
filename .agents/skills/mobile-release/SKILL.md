---
name: mobile-release
description: "Trigger: release, version bump, semver, build the APK, ship a new build, publish a release, tag a version, GitHub Actions release, EAS build, sideload. Bump app.json expo.version and ship the APK through CI."
license: Apache-2.0
metadata:
  author: autoreas-mobile
  version: "1.0.0"
  scope: project
  updates: living
---

# Releasing autoreas-mobile

The version is declared in **one** place: `expo.version` in `app.json`.
`package.json` carries a copy because tooling expects the field; nothing reads it
and it is never the source. A guard fails the release when the two disagree.

> **Proven on `v1.0.0`, 2026-09-05.** The first run went green end to end on the
> first attempt: run `33944095152`, 04:16:06Z → 04:45:51Z, **~29m45s** wall clock.
> `guard` finished in about three minutes and the Gradle build took the rest. The
> APK read back `versionName=1.0.0 versionCode=2`, weighed **132 MiB**
> (138,478,251 bytes), and published with its `SHA256SUMS-android.txt` at
> <https://github.com/Disble/autoreas-mobile/releases/tag/v1.0.0>.
>
> Two things that were guesses when this was written and are now observed: the
> `ubuntu-latest` runner carries an Android SDK whose `build-tools` contain
> `aapt2` (the artifact guards found it), and remote versioning was already
> initialised for this project — the `Remote versions are not configured.` landmine
> below did **not** fire, and EAS handed back `versionCode=2`.
>
> **The hardened workflow is proven too, on `v1.0.1` (run `33983180735`, 27m03s).**
> That release existed only to exercise the SHA pins, `--ignore-scripts` and the
> pinned `eas-cli@23.2.0`, on a candidate where a failure cost nothing; all three
> held. It also confirmed the claim its own changelog made: the APK differed from
> 1.0.0 by **4 bytes** and `versionCode=3`, and nothing else.

There are two ways to produce a build, and they share every precondition below.
Only the last step differs: who runs the build, and where the artifact lands.

| Path | Runs the build | Artifact lands in | Use it for |
|---|---|---|---|
| **CI** (default) | GitHub Actions, on a pushed tag | a published GitHub Release | anything anyone installs |
| **Local** | Docker Desktop on your machine | the project root as `build-*.apk` | smoke-testing before tagging |

A local build is a rehearsal, not a release. It ships nothing and is never the
answer to "cut a release" on its own.

## No Device Is Attached To A Release

**Nothing in this pipeline proves the app runs.** There is no emulator, no adb,
no device in CI, and none at release time. The guards prove the artifact's
*shape* — it is an APK, it reports the tagged version, its manifest still wires
the foreground service — and say nothing whatsoever about its *behaviour*.

This is not a gap to apologise for; it is the boundary to state. The locked-device
sync failure that `docs/mobile-bridge-background-sync-redesign.md` tracks is still
open precisely because device evidence has never been collectable here. A release
report that implies on-device verification happened is a lie. Say which checks ran
and say that behaviour was not verified.

## Branch Model

`dev` carries development. `main` carries deployments.

- Work lands on `dev`. Never commit development directly to `main`.
- A release exists only after `dev` is merged into `main`.
- **Tag the commit on `main`**, never a `dev` commit. The `guard` job refuses a
  tag that is not an ancestor of `main`, so a tag placed on `dev` fails the run
  instead of publishing a build from an unmerged state.

This repo's recorded delivery model was a local merge to `main` with no push and
no PRs. Tagged releases published from CI are a deliberate change to that: the
merge stays local in spirit, but `main` and the tag must both be pushed for a
release to exist.

## Hard Rules

- **`expo.version` never bumps itself. Ever.** `eas.json` sets
  `appVersionSource: "remote"`, and eas-cli's `build/android/build.ts` forces
  `localAutoIncrement: false` whenever that source is remote. The
  `autoIncrement: true` on the `production` profile moves the server-side
  **`versionCode`** only — the build number, not the version anyone sees. Every
  versionName bump is a hand edit, on both `app.json` and `package.json`.
- **`production` must keep `android.buildType: "apk"`.** eas-cli defaults
  `buildType` to APK *only* when `distribution` is `internal` (`prepareJob.ts`);
  with it unset, `resolveGradleCommand` falls through to `:app:bundleRelease` and
  emits an **AAB**. An AAB cannot be sideloaded, so a release built without that
  key publishes a file nobody can install, with a completely green build. This is
  not hypothetical: the profile had no `buildType` until 2026-09-04, and
  `docs/build-and-release.md` described its output as an APK the whole time.
- **Every release updates `CHANGELOG.md`.** Promote `## [Unreleased]` to the new
  `## [X.Y.Z] — YYYY-MM-DD` heading and leave a fresh empty `## [Unreleased]`
  above it. Commit it with `app.json` in the same commit — the version and the
  notes ship together or the release is a lie. CI enforces this: a tag whose
  version has no non-empty CHANGELOG section fails rather than publishing empty
  notes.
- **Write the changelog for the user, not the git log.** Entries say what changed
  for someone using the app, in the app's own vocabulary. `fix(sync): stop a
  mounting screen from erasing live bridge status` is a commit subject; "Opening
  Settings no longer drops a connected Bridge into local mode" is a changelog
  entry. Never paste commit subjects.
- Group under Keep a Changelog headings — `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security` — plus `Internal` for changes with no
  user-visible effect. Omit headings with nothing under them.
- **Never hard-wrap a CHANGELOG entry. One bullet is one line, however long.**
  The workflow copies the section verbatim into the release body, and GitHub
  renders a release body with soft line breaks turned into `<br>` — unlike a `.md`
  file in the repo, where it joins them. An 80-column wrap that is invisible in
  the file becomes a forced break every 80 characters on the release page.
- **Call out a raised Bridge floor explicitly.** This app consumes the Bridge's
  REST/WS contract. A release that stops working against an older Bridge says so
  under its heading and names the minimum version.
- **Corrections are patch releases.** Never re-cut, move, or force-push a tag that
  has already been published — anyone who downloaded it keeps an APK that no
  longer matches the tag, and Android will refuse to install a rebuild over it if
  the signature or versionCode disagrees. Bump to the next patch instead.
- Never commit `build-*.apk` / `build-*.aab`. They are gitignored — artifacts
  ship, they do not get versioned.
- Never `--no-verify`. The pre-commit gate's wall time is `max(quick, heavy)`;
  give `git commit` a timeout of at least 300000 ms.
- The tag format is `v` + the exact `expo.version`, no suffix — `v1.2.0`, not
  `1.2.0` or `release-1.2.0`.
- **Every `uses:` in the workflow is pinned to a 40-character commit SHA, never a
  tag.** A tag is mutable by whoever owns the action, and the publish job holds
  `EXPO_TOKEN` plus `contents: write` — a re-pointed tag there exfiltrates the
  token or publishes whatever it likes. The trailing `# vX.Y.Z` comment names the
  version each SHA was; update both together, deliberately. Do not "tidy" these
  back into tags.
- **`contents: write` lives on the `release` job only.** The workflow default is
  `contents: read`; `guard` never needs more than that to check out, test and
  upload an artifact.

## Decision Gates

| Change shipped | Bump |
|---|---|
| Bug fix, no UX or storage change | patch — `1.0.0` → `1.0.1` |
| New feature, backward compatible | minor — `1.0.1` → `1.1.0` |
| Local database migration that cannot roll back, or a raised Bridge floor | major — `1.1.0` → `2.0.0` |

A migration that rewrites the on-device SQLite schema is the mobile equivalent of
a breaking wire change: the user cannot go back to the previous APK without losing
their local catalogue.

## Shared Preconditions

Do these once, on `dev`, regardless of which path ships the build.

1. Read the current version: `node -p "require('./app.json').expo.version"`.
2. Review what actually shipped since the last release
   (`git log --oneline $(git describe --tags --abbrev=0)..HEAD`; for the first
   release there is no tag, so review `git log --oneline main..dev`) and decide
   the bump from the Decision Gates above.
3. Set the new version in **both** `app.json` (`expo.version`) and `package.json`
   (`version`). They must be byte-identical, with no `v` prefix.
4. Update `CHANGELOG.md`: promote `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`,
   add a fresh empty `## [Unreleased]` above it, and write the entries in user
   language under the Keep a Changelog headings.
5. Append the release rationale to `docs/learning-log.md` with
   `node scripts/log-lesson.mjs "..."` — never by hand.
6. Commit on `dev` as `chore(release): bump to X.Y.Z`.

## Path A — Ship through CI (default)

7. Merge `dev` into `main` and push `main`.
8. Tag the merge commit on `main`: `git tag vX.Y.Z`. Confirm it landed where you
   think with `git tag --points-at HEAD`.
9. Push the tag. That, and only that, starts a release:
   `git push origin refs/tags/vX.Y.Z`.
10. Watch the run: `gh run list --workflow Release --limit 1`. On success the
    release is published — not drafted — at
    `https://github.com/Disble/autoreas-mobile/releases/tag/vX.Y.Z`.

### What CI publishes

- `autoreas-mobile-X.Y.Z-android.apk` (~132 MiB on 1.0.0)
- `SHA256SUMS-android.txt`

Android only. There is no iOS profile in `eas.json` and no Apple account wired to
this project.

Budget about **30 minutes** from pushed tag to published release, nearly all of it
Gradle. `guard` fails inside three minutes when it is going to fail, which is the
whole reason it is a separate job.

### The guards CI runs, and what each one catches

Every one of these exists because its failure mode is **silent** — a green build
that ships something broken. Do not remove one to make a run pass.

| Guard | Catches |
|---|---|
| tag vs `app.json` `expo.version` | a tag that disagrees with the version the app reports |
| `package.json` vs `app.json` | the second version field drifting away from the source |
| CHANGELOG section exists and is non-empty | a release published with empty notes |
| tagged commit is an ancestor of `main` | a release cut from unmerged `dev` |
| `typecheck` + `test` on the runner | a tag cut from a commit whose pre-commit hook **failed open** |
| no `BundleConfig.pb` in the artifact | `android.buildType` lost ⇒ an AAB nobody can sideload |
| `aapt2 dump badging` versionName == tag | a stale prebuild shipping the previous version name |
| manifest still declares `app.notifee.core.ForegroundService` + `foregroundServiceType`, and all four permissions | `withAndroidForegroundSync` silently no longer applying ⇒ Android 14+ refuses to start the service and background sync dies on device while every test stays green |

`lint` is deliberately **absent** from the runner. It is enforced per staged file
by the pre-commit hook; `eslint .` repo-wide still carries standing `dharness`
debt that has nothing to do with any one release, and wiring it here would paint
every release red for files the release never touched. Measured 2026-09-04:
`bun run lint` exits 1 with **252 problems (194 errors, 58 warnings)** — down from
the 305 errors CLAUDE.md constraint 12 recorded on 2026-08-29, because that debt is
paid down per file as files are touched, never in bulk.

The `typecheck` + `test` guard is not redundant with the pre-commit hook. A
clobbered lefthook hook **exits 0 while running nothing** (`docs/build-and-release.md`
→ "Hooks look wrong after a Docker build"), so the local gate cannot be trusted to
have run on the commit being tagged. Measured on this repo: 142 suites / 953 tests
in ~18s.

Signing keys are not in this repository and must not be. `credentialsSource`
defaults to `remote`, so `AndroidCredentialsProvider.getRemoteAsync()` pulls the
keystore from EAS over its API. `EXPO_TOKEN` is the only secret the workflow needs.

## Path B — Build locally

Use this to smoke-test before tagging, or when you need an APK without publishing
one.

7. Build the production profile in the container:
   ```bash
   docker compose -f docker-compose.eas.yml run --rm eas-build production
   ```
8. Confirm the artifact is an APK and reports the version you expect. Do not trust
   the filename:
   ```bash
   unzip -l build-*.apk | grep -q BundleConfig.pb && echo "THIS IS AN AAB"
   aapt2 dump badging build-*.apk | head -1
   ```
9. Install it and exercise what neither tests nor those checks can reach — startup,
   pairing, SQLite, sync against a running Bridge, background sync with the screen
   off. **If you have no device, say so and stop claiming this step.** See
   [No Device Is Attached To A Release](#no-device-is-attached-to-a-release).

Everything Docker-specific in `docker-compose.eas.yml` — `network_mode: host`,
`-Djava.net.preferIPv4Stack=true`, the CA certificate refresh — exists to work
around Docker Desktop on Windows, not Linux. The CI runner needs none of it. The
one setting that matters on both is `CI=true`, which stops lefthook's postinstall
from rewriting the host's Git hooks; GitHub Actions exports it for free.

## Known Issues, Not Regressions

- **Android warns on every sideload.** The APK is signed with the EAS-managed
  keystore, but it is not distributed through Play, so the install-from-unknown-sources
  prompt and Play Protect scanning both apply. The published `SHA256SUMS-android.txt`
  is the integrity mitigation in place. Do not report this as caused by a bump.
- **The app never displays its own version.** Nothing under `src/` reads
  `expo.version`, `Constants.expoConfig`, or `Application.nativeApplicationVersion`
  — verified by grep. The only way to tell which build is installed is Android's
  app info screen. A "wrong version showing in the app" report is therefore about
  something else.
- **`bun run validate` fails repo-wide** because it includes `lint` (measured
  2026-09-04: exit 1, 252 problems). Use `bun run typecheck && bun run test` when
  you want a green pre-tag check locally — that is exactly what CI runs.
  `docs/build-and-release.md`'s release checklists still say `bun run validate`;
  that instruction has not worked since the `dharness` layer went live.

## Landmines

- **The pinned actions target Node 20, which GitHub is retiring.** Both v1.0.0 and
  v1.0.1 raised the annotation *"Node.js 20 is deprecated. The following actions
  target Node.js 20 but are being forced to run on Node.js 24:
  `actions/checkout`, `actions/upload-artifact`"*. It is a warning today and the
  runner substitutes Node 24 for you, but the substitution is a courtesy that ends.
  This is the standing cost of pinning: a SHA freezes the runtime an action targets
  as well as its code, so it is now on you to move it. When `actions/checkout` and
  `actions/upload-artifact` publish releases built for Node 24, bump both the SHA
  and its trailing version comment. Do not answer this warning by going back to
  floating tags.

- **`Remote versions are not configured.`** With `appVersionSource: "remote"`,
  eas-cli resolves `versionCode` from its servers; when no remote version exists
  it falls back to `expo.android.versionCode`, which this repo does not declare,
  and then throws. If a build dies with that string, initialise it once with
  `eas build:version:set` — do **not** "fix" it by adding a local `versionCode`,
  which reintroduces a second source of truth. It did not fire on 1.0.0: remote
  versioning was already initialised for this project and EAS returned
  `versionCode=2`. It stays documented because nothing in the repo records that
  remote state, so a new EAS project or a reset would hit it cold.
- **The workflow pins `eas-cli`; the container still floats on `@latest`.** CI runs
  `bunx eas-cli@23.2.0` — the exact version that built v1.0.0 — because a release
  must not change behaviour without this repo changing (SonarQube `S8543`).
  `docker-compose.eas.yml` deliberately keeps `@latest`, since a local build is a
  rehearsal and picking up fixes early there is the point. **The two therefore
  drift**, and that is the trade: a rehearsal can pass on a newer CLI than the one
  that will ship it. When you bump the pin, bump it to a version you rehearsed, and
  say so in the commit.
- **Both CI installs pass `--ignore-scripts`** (SonarQube `S6505`). Nothing in this
  repo needs a lifecycle script to run — `package.json` has no `prepare` by design
  and `trustedDependencies` lists only lefthook — so the flag costs nothing and
  stops the runner rewriting hooks even if `CI=true` ever goes missing. Do not
  remove it to "fix" an install; if an install needs a script, that is the thing to
  question.

## Agent Notes

- SSH push may fail from an agent shell (`Permission denied (publickey)`) while
  `gh` is authenticated. Push without changing the user's config using a one-shot
  helper:
  `git -c credential.helper='!gh auth git-credential' push https://github.com/Disble/autoreas-mobile.git <branch>`
- Pushing `main` and a tag is outward-facing and irreversible once a release
  publishes. Confirm with the user before the push, every time — this repo's
  default delivery model has no push in it at all.
- The full suite is fast (~18s at `--maxWorkers=4`). There is no reason to skip it
  before tagging.

## Output Contract

Report: the old and new version, both version fields you edited, the changelog
section written, the branch the tag sits on, the workflow run result with each
guard's output, the published release URL with its asset list and the APK's
SHA-256, and — explicitly — that **no on-device verification was performed**,
naming which behaviour therefore remains unverified.

## References

- `app.json` — `expo.version`, the single source of the version.
- `package.json` — the copy the guard keeps equal to it.
- `eas.json` — `appVersionSource: remote`, and `production.android.buildType: apk`.
- `.github/workflows/release.yml` — tag trigger, the guard job, build and publish.
- `docker-compose.eas.yml` — the local rehearsal path and why `CI=true` is there.
- `plugins/withAndroidForegroundSync.js` — the only source of the foreground
  service type the manifest guard checks for.
- `docs/build-and-release.md` — build paths, Git hooks, device checklists.
- `docs/learning-log.md` — why entries.
- `CLAUDE.md` constraint 12 — why `lint` is not a release guard.
