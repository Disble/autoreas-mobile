# Changelog

All notable changes to Autoreas Mobile are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version itself is declared in exactly one place — `expo.version` in `app.json`.
`package.json` carries a copy only so tooling that expects one finds it, and the
release workflow fails when the two disagree. An entry here without a matching bump
there is a bug in the release, not a changelog style choice. See
`.claude/skills/mobile-release/SKILL.md`.

The Bridge's REST/WS contract is consumed by this app, so a release that requires a
minimum Bridge version says so explicitly under its heading.

## [Unreleased]

## [1.1.0] — 2026-09-08

**No new Bridge version is required.** This release works against every Bridge that 1.0.1 worked against. The diagnostic records it now keeps are offered to a Bridge endpoint that older versions do not have; those Bridges decline them harmlessly and the app holds the records until a Bridge that accepts them is reachable.

### Added

- When a background sync fails, the app now keeps its record of what went wrong on the device and hands it to the Bridge the next time one is reachable, instead of discarding it the moment the failing attempt ends. Previously a phone that spent a day away from its Bridge delivered one such record and destroyed roughly ninety-five others — including the one signal that says whether Android let the background job run at all, which is exactly the evidence that was missing every time background sync misbehaved and nobody could say why.
- Kept records are capped at one hundred, oldest discarded first, so a long stretch offline cannot grow them without bound. Sending them is deliberately given up on quickly when the Bridge is unreachable, so a device that cannot connect never spends its sync window retrying diagnostics instead of syncing your catalogue.
- The diagnostics switch in Settings governs this completely: with it turned off nothing is recorded and nothing accumulates on the device.

### Fixed

- A rate-limit or slow-down response from the Bridge could previously be misread as an instruction to retry immediately, because of a quirk in how the phone interpreted a malformed delay. Delays are now read strictly, and an unreadable one is ignored rather than treated as "retry now".

### Internal

- Diagnostic records are stored in the existing separate telemetry database, written on their own connection, so recording a sync failure can never queue behind the very database contention it is reporting on.
- Delivery is attempted from the single point every sync trigger already passes through, so a reconnect, a foreground refresh, or a background cycle all drain the backlog without any new scheduler.
- A failed delivery can never fail the sync cycle that carried it, and cannot reach the code path that returns pending catalogue changes to the queue.
- Only a Bridge response that rejects the record's own contents discards it; an unreachable or unavailable Bridge always preserves it.

## [1.0.1] — 2026-09-05

**Nothing changed for you.** The APK in this release behaves exactly like 1.0.0 — only the pipeline that builds it changed. If you already have 1.0.0 installed there is no reason to update, and the two differ only in build number.

### Internal

- The release workflow pins every GitHub Action it uses to a full commit SHA instead of a moving tag, so the job that holds the signing token and the publish permission cannot silently begin running different code.
- Write permission is no longer granted across the whole workflow; only the job that publishes the release holds it, and the checks that run before it are read-only.
- Dependency installation on the runner passes `--ignore-scripts`, so no package lifecycle script can execute there regardless of what the environment says.
- The EAS CLI is pinned to the exact version that built 1.0.0 rather than tracking `@latest`, so a release can no longer change behaviour without this repository changing.

## [1.0.0] — 2026-09-04

First published release. The app has existed for a while; this is the first build anyone can download rather than compile. The entries below are what changed most recently — for everything before them, the app is what the README describes: an Android client that keeps a local anime catalogue in SQLite and syncs it against an Autoreas Bridge on your network.

Install the APK below and allow installation from unknown sources. Verify it against `SHA256SUMS-android.txt` if you care to.

### Added

- **Sync now carries the Bridge's version token for each anime.** Until now the app had no way to learn the token it needed to send back, so an edit made on the phone silently overwrote whatever the desktop had done in the meantime. Concurrent edits on both sides are now detected and reconciled per record instead of one side winning by accident.

### Fixed

- **Background sync runs every 15 minutes instead of every 15 hours.** The interval shipped as 15 hours, which meant the catalogue on the phone could sit most of a day behind the Bridge. Every request a cycle makes is now bounded as well, so a Bridge that stops answering can no longer hold a sync cycle open indefinitely.
- **Opening Settings no longer drops a connected Bridge into local mode.** Entering the screen reported "Bridge configurado en modo local" and going back to the list showed "Catálogo local listo", with only a manual sync restoring the real status until the next visit did it again. The connection status now waits for the Bridge configuration to actually answer instead of reading an unanswered query as "no Bridge is paired".
- **Refreshing right after a screen opens no longer reports a sync that transferred nothing.** A refresh requested before the configuration query answered took the "not configured" path, erased the shared connection status and completed with zero records synced.
- **Records the phone had never seen are no longer discarded.** An update arriving from the Bridge for an anime absent from the local catalogue was dropped instead of being inserted.
- **A local database whose schema does not match the app is repaired instead of skipped.** The migrator silently passed over schemas it could not reconcile, and background sync now refuses outright to run against a database whose schema stamp does not tell the truth.
- **A sync that cannot reach the local database gives up instead of waiting forever.** The write path is now bounded by a deadline that expires rather than granting access late.

### Changed

- **The project is licensed under Apache-2.0.**
- **The README is now a project front door** — what the app is, how to run it, and where the rest of the documentation lives.

### Internal

- Core sync behaviour is covered by a suite that runs against a real database rather than a mocked one.
- The deprecated dlinter preset and its sonarjs rules were removed.
- Oversized sync helpers were split back under the file-size ceiling.
- The MCP bridge server path resolves portably instead of pointing at one developer's machine.
