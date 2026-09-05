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
