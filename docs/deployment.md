# Deployment

A deployment is a **pushed `vX.Y.Z` tag on `main`**. Nothing else publishes anything — not a branch
push, not a manual dispatch, not a local build. The tag starts
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds a signed Android
APK on GitHub's runners and publishes it to GitHub Releases with its SHA-256 checksum.

> Back to the [README](../README.md). To produce a build **without** deploying one — EAS profiles,
> the local Docker path, Git hooks — see [Build and release](build-and-release.md).

---

## What a deployment produces

| | |
| --- | --- |
| Platform | Android only. `eas.json` declares no iOS profile and no Apple account is wired to this project. |
| Artifact | `autoreas-mobile-X.Y.Z-android.apk` — about 132 MiB |
| Checksum | `SHA256SUMS-android.txt` |
| Destination | `https://github.com/Disble/autoreas-mobile/releases/tag/vX.Y.Z`, **published**, not drafted |
| Distribution | sideload only; the app is not on Google Play |
| Wall clock | ~30 minutes from pushed tag. Measured: 29m45s on `v1.0.0`, 27m03s on `v1.0.1`. |

The `guard` job fails within about three minutes when it is going to fail. That is why it is a
separate job — a bad tag costs three minutes, not a twenty-minute Gradle build.

---

## Quick path

Everything up to step 6 happens on `dev`.

1. **Read the current version.**

   ```bash
   node -p "require('./app.json').expo.version"
   ```

2. **Decide the bump** from [Choosing the bump](#choosing-the-bump), reviewing what actually
   shipped:

   ```bash
   git log --oneline $(git describe --tags --abbrev=0)..HEAD
   ```

3. **Set the new version in both files.** `app.json` → `expo.version` and `package.json` →
   `version`, byte-identical, with no `v` prefix. Nothing bumps these for you — see
   [The version never bumps itself](#the-version-never-bumps-itself).

4. **Write the changelog.** Promote `## [Unreleased]` in `CHANGELOG.md` to `## [X.Y.Z] — YYYY-MM-DD`,
   leave a fresh empty `## [Unreleased]` above it, and follow [Changelog rules](#changelog-rules).
   CI copies this section verbatim into the release body.

5. **Record the rationale.**

   ```bash
   node scripts/log-lesson.mjs "..."
   ```

6. **Commit** as `chore(release): bump to X.Y.Z`. The version and the notes ship in the same commit.

7. **Merge `dev` into `main` and push `main`.** A tag that is not an ancestor of `main` is refused.

8. **Tag the merge commit and push the tag.** This is the irreversible step.

   ```bash
   git tag vX.Y.Z
   git tag --points-at HEAD          # confirm it landed where you think
   git push origin refs/tags/vX.Y.Z
   ```

9. **Watch the run.**

   ```bash
   gh run list --workflow Release --limit 1
   ```

---

## Choosing the bump

| Change shipped | Bump |
| --- | --- |
| Bug fix, no UX or storage change | patch — `1.0.0` → `1.0.1` |
| New feature, backward compatible | minor — `1.0.1` → `1.1.0` |
| Local SQLite migration that cannot roll back, or a raised Bridge floor | major — `1.1.0` → `2.0.0` |

A migration that rewrites the on-device schema is the mobile equivalent of a breaking wire change:
the user cannot return to the previous APK without losing their local catalogue.

---

## Branch model

`dev` carries development. `main` carries deployments.

- Work lands on `dev`. Never commit development directly to `main`.
- A release exists only after `dev` is merged into `main`.
- **Tag the commit on `main`**, never a `dev` commit. The `guard` job refuses a tag that is not an
  ancestor of `main`, so a misplaced tag fails the run instead of publishing from an unmerged state.

This repository's default delivery model is a local merge with no push and no pull requests. Tagged
releases are the deliberate exception: `main` and the tag must both reach `origin` for a release to
exist at all.

---

## The pipeline

Two jobs. The second runs only if the first passes.

### `guard` — everything knowable without building

Runs on `ubuntu-latest` with `contents: read`.

| Check | What it catches |
| --- | --- |
| Tag parses as `v` + semver | a malformed tag naming no version |
| Tag equals `app.json` `expo.version` | a tag that disagrees with the version the app reports |
| `package.json` equals `app.json` | the second version field drifting away from the source |
| `CHANGELOG.md` has a non-empty `## [X.Y.Z]` section | a release published with empty notes |
| Tagged commit is an ancestor of `main` | a release cut from unmerged `dev` |
| `bun run typecheck` | a type error reaching a published build |
| `bun run test` | a tag cut from a commit whose pre-commit hook **failed open** |

The extracted changelog section is uploaded as the `release-notes` artifact and becomes the release
body.

**`lint` is deliberately absent.** It is enforced per staged file by the pre-commit hook. Repo-wide
`eslint .` still exits 1 on standing `dharness` debt that has nothing to do with any one release
(measured 2026-09-04: 252 problems), and wiring it here would paint every release red for files the
release never touched. See CLAUDE.md constraint 12.

The `typecheck` + `test` pair is **not** redundant with the pre-commit hook. A clobbered Lefthook
hook exits 0 while running nothing, so the local gate cannot be trusted to have run on the commit
being tagged — see
[Hooks look wrong after a Docker build](build-and-release.md#hooks-look-wrong-after-a-docker-build).

### `release` — build, interrogate the artifact, publish

The only job that holds `contents: write`, and the only one that sees `EXPO_TOKEN`. It builds with a
pinned CLI:

```bash
bunx eas-cli@23.2.0 build --local --platform android --profile production --non-interactive --output "$APK"
```

Then it interrogates the artifact with `aapt2` before publishing it:

| Check | What it catches |
| --- | --- |
| No `BundleConfig.pb` in the archive | `eas.json` losing `android.buildType` ⇒ an **AAB** nobody can sideload, on a fully green build |
| `versionName` equals the tag | a stale prebuild shipping the previous version name |
| Manifest declares `app.notifee.core.ForegroundService` and `foregroundServiceType` | `plugins/withAndroidForegroundSync.js` silently no longer applying ⇒ Android 14+ refuses to start the service and background sync dies on device while every test stays green |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS`, `WAKE_LOCK` present | a permission dropped from the shipped manifest |

Every one of those exists because its failure mode is **silent**. Do not remove one to make a run
pass.

Finally it writes `SHA256SUMS-android.txt` and calls `gh release create` with the APK, the checksum
file and the extracted notes.

---

## Secrets and signing

| | |
| --- | --- |
| `EXPO_TOKEN` | the only repository secret the workflow needs |
| Signing keystore | **not in this repository.** `credentialsSource` defaults to `remote`, so EAS hands the keystore down over its API at build time. |
| `GH_TOKEN` | the run's own `github.token`; no personal token is involved |

Least privilege is deliberate. The workflow default is `contents: read`; only `release` is granted
write, and every `uses:` is pinned to a 40-character commit SHA rather than a tag. A tag is mutable
by whoever owns the action, and this job holds both the token and the write scope. The trailing
`# vX.Y.Z` comment names the version each SHA was — update both together. Do not "tidy" these back
into floating tags.

---

## What a deployment does not prove

**Nothing in this pipeline proves the app runs.** There is no emulator, no adb and no device in CI,
and none at release time. The guards prove the artifact's *shape* — that it is an APK, that it
reports the tagged version, that its manifest still wires the foreground service — and say nothing
whatsoever about its *behaviour*.

This is a boundary to state, not a gap to apologise for. A release report that implies on-device
verification happened is false. Say which checks ran, and say that behaviour was not verified.

To exercise behaviour before tagging, build the production profile locally and install it — see
[Rehearse locally first](#rehearse-locally-first).

---

## Rehearse locally first

A local build is a rehearsal. It ships nothing and is never the answer to "cut a release".

```bash
docker compose -f docker-compose.eas.yml run --rm eas-build production
```

Never trust the filename — confirm the artifact is an APK and reports the version you expect:

```bash
unzip -l build-*.apk | grep -q BundleConfig.pb && echo "THIS IS AN AAB"
aapt2 dump badging build-*.apk | head -1
```

Then install it and exercise what neither the tests nor those checks can reach: startup, pairing,
SQLite, sync against a running Bridge, and background sync with the screen off.

Requirements, the other build profiles and the Docker-on-Windows workarounds live in
[Build and release](build-and-release.md#native-builds).

---

## Hard rules

### The version never bumps itself

`eas.json` sets `appVersionSource: "remote"`, and eas-cli forces `localAutoIncrement: false`
whenever that source is remote. The `autoIncrement: true` on the `production` profile moves the
server-side **`versionCode`** only — the build number, not the version anyone sees. **Every
`versionName` bump is a hand edit, on both `app.json` and `package.json`.**

`expo.version` in `app.json` is the single source. `package.json` carries a copy only because
tooling expects the field; nothing reads it, and the `guard` job fails when the two disagree.

### `production` must keep `android.buildType: "apk"`

eas-cli defaults `buildType` to APK *only* when a profile declares `distribution: "internal"`. With
the key unset, the Gradle command falls through to `:app:bundleRelease` and emits an **AAB**, which
cannot be sideloaded. A release built that way publishes a file nobody can install, with a
completely green build. The profile carried no `buildType` until 2026-09-04 and the docs described
its output as an APK the whole time — hence the artifact guard.

### Corrections are patch releases

**Never re-cut, move or force-push a published tag.** Anyone who downloaded it keeps an APK that no
longer matches the tag, and Android refuses to install a rebuild over it when the signature or
`versionCode` disagrees. Bump to the next patch instead.

There is no rollback and no unpublish. The previous release stays installable at its own tag; that
is the whole recovery path.

### Changelog rules

- Write for the user, not the git log. `fix(sync): stop a mounting screen from erasing live bridge
  status` is a commit subject. "Opening Settings no longer drops a connected Bridge into local mode"
  is a changelog entry. Never paste commit subjects.
- Group under Keep a Changelog headings — `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
  `Security` — plus `Internal` for changes with no user-visible effect. Omit empty headings.
- **Never hard-wrap an entry. One bullet is one line, however long.** GitHub renders a release body
  with soft line breaks turned into `<br>`, unlike a `.md` file in the repo. An 80-column wrap that
  is invisible in the file becomes a forced break every 80 characters on the release page.
- Call out a raised Bridge floor explicitly and name the minimum version. This app consumes the
  Bridge's REST/WS contract.

### Other invariants

- The tag format is `v` plus the exact `expo.version` — `v1.2.0`, never `1.2.0` or `release-1.2.0`.
- Never commit `build-*.apk` / `build-*.aab`. They are gitignored; artifacts ship, they are not
  versioned.
- Never `git commit --no-verify`. The pre-commit gate is slow — give the commit a timeout of at
  least 300 seconds rather than skipping it.

---

## Pre-tag checklist

- [ ] `app.json` `expo.version` and `package.json` `version` are identical and new
- [ ] `CHANGELOG.md` has a non-empty section for that exact version, written in user language, with
      no hard wraps
- [ ] `docs/learning-log.md` records the rationale, appended via `scripts/log-lesson.mjs`
- [ ] `bun run typecheck && bun run test` is green locally — not `bun run validate`, see
      [Known friction](#known-friction)
- [ ] `dev` is merged into `main`, and `main` is pushed
- [ ] The tag points at the merge commit on `main`
- [ ] On-device behaviour is either verified against a real device, or explicitly reported as
      unverified

---

## Known friction

**Android warns on every sideload.** The APK is signed with the EAS-managed keystore but is not
distributed through Play, so the install-from-unknown-sources prompt and Play Protect scanning both
apply. The published `SHA256SUMS-android.txt` is the integrity mitigation in place. This is not
caused by any particular release.

**The app never displays its own version.** Nothing under `src/` reads `expo.version`,
`Constants.expoConfig` or `Application.nativeApplicationVersion`. The only way to tell which build is
installed is Android's app info screen.

**`bun run validate` fails repo-wide** because it includes `lint`. Use `bun run typecheck && bun run
test` for a green pre-tag check — that is exactly what CI runs.

**The pinned actions target Node 20, which GitHub is retiring.** Both `v1.0.0` and `v1.0.1` raised
*"Node.js 20 is deprecated … `actions/checkout`, `actions/upload-artifact`"*. The runner substitutes
Node 24 today, but that substitution is a courtesy that ends. This is the standing cost of pinning:
a SHA freezes the runtime an action targets as well as its code. When those actions publish releases
built for Node 24, bump the SHA and its version comment together. Do not answer this warning by
returning to floating tags.

**`Remote versions are not configured.`** With `appVersionSource: "remote"`, eas-cli resolves
`versionCode` from its servers; when no remote version exists it falls back to
`expo.android.versionCode`, which this repo does not declare, and then throws. Initialise it once
with `eas build:version:set`. Do **not** "fix" it by adding a local `versionCode` — that
reintroduces a second source of truth. It has never fired here; it stays documented because nothing
in the repo records that remote state, so a new EAS project or a reset would hit it cold.

**CI pins `eas-cli`; the local container floats on `@latest`.** The workflow runs `eas-cli@23.2.0`
because a release must not change behaviour without this repository changing.
`docker-compose.eas.yml` deliberately keeps `@latest`, since picking up fixes early in a rehearsal
is the point. **The two therefore drift** — a rehearsal can pass on a newer CLI than the one that
will ship it. When you bump the pin, bump it to a version you actually rehearsed.

---

## Where the truth lives

`.github/workflows/release.yml` is executable and therefore authoritative. This document explains it;
it does not enforce it. When you change the pipeline, change these together:

| File | Owns |
| --- | --- |
| [`.github/workflows/release.yml`](../.github/workflows/release.yml) | the tag trigger, both jobs and every guard |
| [`eas.json`](../eas.json) | `appVersionSource: remote` and `production.android.buildType: apk` |
| [`app.json`](../app.json) | `expo.version`, the single source of the version |
| [`.claude/skills/mobile-release/SKILL.md`](../.claude/skills/mobile-release/SKILL.md) | the agent-facing copy of this procedure |
| This document | the human-facing procedure |
