# Release cache upload pruning

Objective: reduce release CI network/storage overhead without adding jobs, build work, or delaying a tag. The v1.7.0 run (36261199520) restored zero Gradle cache entries in both `native` and `build`, yet saved 2.32 GB and 1.98 GB under a tag-scoped ref. GitHub does not share one tag's cache with later tags, and this repository has no default-branch Gradle cache writer.

Branch: `perf/release-cache-upload-pruning` (from `main`). Status: in progress. Delivery strategy: `ask-on-risk`; initial forecast <150 authored diff lines, now ~380 after adding protective regression assertions, one work-unit commit. No push, tag, PR, or release authorized.

Scope: change only tag-job Gradle cache write policy and its regression evidence/documentation. Keep `setup-gradle` with `cache-provider: basic`, wrapper validation, action SHA pins, release safeguards, and tag-only trigger intact. Leave Bun/Gradle step ordering unchanged: key alignment cannot help future releases without a cache they can read. Do not add main-branch warming, run a new remote EAS build, enable release Gradle task-output caching, or weaken the native gate.

TDD: off for this workflow-configuration change; project `AGENTS.md` requires RED → GREEN → MUTATE → REFACTOR for helper/hook changes, but no helper or hook is changed here. Use focused workflow regression assertions and the repository's pre-commit gate. A real tag-to-tag cache restore cannot be verified locally and remains pending for a future authorized release.

## Tasks

- [ ] **T1 — Stop unreachable tag cache uploads.** Route: delegated `gentle-ai-worker` (nontrivial workflow + tests + documentation, multi-file writer trigger). Set both `native` and `build` Gradle caches read-only; add focused regression assertions in `tests/scripts/` if the existing test harness supports them, and correct the current release caching claims in relevant documentation without rewriting historical records. Acceptance: both jobs remain able to restore; neither writes tag-scoped caches; tags still exclusively trigger release; all artifact and publish gates stay intact. Checks: focused Jest regression, `bun run typecheck`, `npx lefthook run pre-commit`; parent spot-check workflow diff and report any unavailable remote runtime. Commit: pending. Authored lines: pending.

## Progress

- 2026-09-26: User declined extra CI time for default-branch cache seeding. Verified v1.7.0 cache misses and saved tag-only entries; constrained solution to removing waste from the existing release run. Fresh GitHub Actions cache behavior on a future tag remains unverified.
- 2026-09-26: T1 implementation changes both tag jobs to read-only and adds 14 focused workflow assertions; a deliberate flip back to `false` in `native` failed 2 assertions before restoration. Writer checks: focused Jest 14/14, typecheck and touched-file ESLint pass. Parent spot-check: focused Jest 14/14. Independent verification: `npx lefthook run pre-commit` passed (187 suites, 1618 tests; native hook skipped because no native source/fixture staged), staged diff unchanged, `git diff --cached --check` passed. A read-only native risk assessment was unassessable due to untracked new files, so independent verification was required and completed. Corrected C5 to distinguish the 30m01s APK build **step** from the 30m43s build **job**. Runtime harness: N/A because a new tag would trigger a remote release. Exact future CI speedup is unmeasured; the observed avoidable uploads were 2.32 GB + 1.98 GB on v1.7.0.

Next: stage the final logbook/task correction, re-run the local gate, commit the cohesive work unit, then mark T1 complete with the commit identity.
