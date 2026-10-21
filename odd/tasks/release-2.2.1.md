# Release 2.2.1
Objective: Publish the status-only anime fix as an Android patch release. Branch: dev -> main; delivery: single release, no PR.
Checks: existing release guards, pre-commit hooks, CI Release workflow and published APK checksum; no on-device verification.

## Specs
- S1: "release"
- S2: "Sí, publicar v2.2.1"

## Tasks
- T1 [S1,S2] Prepare version 2.2.1, user-facing notes and scripted learning-log rationale; verify and commit on dev. Route: delegated writer (runtime context backstop), independent verifier (Risk item 5: release). Status: done. Commit: 35b6f4db8d3d0a3ebd4562f3aafb0f9942c95e70; independent verification passed and all commit hooks passed (249 suites/2292 tests).
- T2 [S2] Merge dev into main, push main and tag v2.2.1, and identify the exact Release workflow run. Route: inline delivery. Status: in_progress. Commit/run: merge prepared without conflicts; merge commit and remote publication pending.
- T3 [S1,S2] Watch the exact run, verify published APK/checksum assets, and report checks and device-proof boundary. Route: inline background CI wait and artifact verification. Status: pending. Evidence: pending.

## Log
- L1 (2026-10-21): User request: "release".
- L2 (2026-10-21): Confirmation question: "La última release es v2.2.0. ¿Autorizas publicar v2.2.1 con esta corrección, fusionando dev en main y subiendo main y el tag para que CI genere y publique el APK en GitHub?" User selected: "Sí, publicar v2.2.1" (publish-v2.2.1). This authorizes these main/tag pushes and CI's configured EAS signing operation, not a local credential retrieval or device install.
- L3: Source before preparation: dev 4a6700725fc1db8513f9b337a5c552af604c4f52; local and remote main plus remote v2.2.0 point to e52161d00dc6bb660f1b82f7ba0fe69d11bcbbe6. Remote v2.2.1 absent. Local tags are stale (git describe reports v1.10.0); GitHub lists v2.2.0 as latest. Worktree clean. app.json and package.json both 2.2.0.
- L4: Scope since main: 8b91d57 status-only anime update fix and 4a67007 local Pi ignore rule. Patch bump; no new behavior, migrations, dependency changes or Bridge floor change. Preserve Bridge >=2.0.0. Existing code proof: 249 suites/2292 tests, 46 focused tests, manual mutant, 28 literal chapter differential cases, independent verification and React Doctor exit 0 (84/100, no issues reported). Release preparation changes metadata, not behavior, so no meaningful RED; use existing guards.
- L5: Forecast <=150 authored changed lines, excluding future evidence log updates; delivery strategy single release. Never rewrite an existing published tag, skip hooks, include .pi, or claim device execution. CI proves artifact shape only; startup, state change and background sync on an installed APK remain unverified here.
- L6: Worker mvibovlt-3-b5tc prepared app.json/package.json 2.2.1, dated CHANGELOG notes and one script-appended learning-log entry. Parent read the full diff and verified equal versions and clean whitespace. Exact CI notes extraction found nonempty notes with single-line bullets and empty Unreleased; production still uses remote versioning and APK. No behavior change and no meaningful RED. Independent release verification and commit hooks remain pending. Initial native assessment required an explicit declaration for the new untracked feature document; the document is included in this release commit, not excluded.
- L7: Independent verifier mvibse7i-4-rxxv passed S1/S2 for T1 with no blockers: exact version-only changes, CI notes extraction, preserved changelog history/Bridge floor and single appended lesson. Parent repeated version equality and clean-diff checks. Normalized native assessment: nativeRisk medium, reviewDue false (under_budget), item-5 escalation requires the independent verifier already completed; no native review is due. Release commit/hooks are next.
- L8: Release commit 35b6f4db8d3d0a3ebd4562f3aafb0f9942c95e70 completed on dev; hooks passed 249 suites/2292 tests, coverage, typecheck and audit. Native committed-range assessment against 4a67007 again returned nativeRisk medium and reviewDue false; independent item-5 verification is already satisfied. Switched to main and prepared a no-fast-forward merge of dev with --no-commit; no conflicts. This merge commit will include the T1 evidence before the authorized push/tag.
