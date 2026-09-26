# Release cache upload pruning

Objective: reduce release CI network/storage overhead without adding jobs, build work, or delaying a tag. The v1.7.0 run (36261199520) restored zero Gradle cache entries in both `native` and `build`, yet saved 2.32 GB and 1.98 GB under a tag-scoped ref. GitHub does not share one tag's cache with later tags, and this repository has no default-branch Gradle cache writer.

Branch: `perf/release-cache-upload-pruning` (from `main`). Status: complete locally. Delivery strategy: `ask-on-risk`; initial forecast <150 authored diff lines, final work unit 366 authored diff lines (335 additions + 31 deletions), under the ~400 review heuristic. No push, tag, PR, or release authorized.

Scope: change only tag-job Gradle cache write policy and its regression evidence/documentation. Keep `setup-gradle` with `cache-provider: basic`, wrapper validation, action SHA pins, release safeguards, and tag-only trigger intact. Leave Bun/Gradle step ordering unchanged: key alignment cannot help future releases without a cache they can read. Do not add main-branch warming, run a new remote EAS build, enable release Gradle task-output caching, or weaken the native gate.

TDD: off for this workflow-configuration change; project `AGENTS.md` requires RED → GREEN → MUTATE → REFACTOR for helper/hook changes, but no helper or hook is changed here. Use focused workflow regression assertions and the repository's pre-commit gate. A real tag-to-tag cache restore cannot be verified locally and remains pending for a future authorized release.

## Tasks

- [x] **T1 — Stop unreachable tag cache uploads.** Route: delegated `gentle-ai-worker` (nontrivial workflow + tests + documentation, multi-file writer trigger). Both `native` and `build` Gradle caches are read-only; 14 focused regression assertions pin the policy, trigger, wrapper validation, artifact and publish gates. Relevant documentation retains historical rows and clarifies C5. Checks: focused Jest 14/14, `bun run typecheck`, independent verification and `npx lefthook run pre-commit` (187 suites / 1618 tests), parent spot-check and `git diff --cached --check` all passed. Native hook skipped because no native source/fixture staged. Work-unit commit: `f027aeac6ee5703b537f873e4caf11ddcb96b6e9`. Rollback boundary: revert this commit to remove the tag cache policy, matching static test and its docs without touching native build or publish logic.

## Progress

- 2026-09-26: User declined extra CI time for default-branch cache seeding. Verified v1.7.0 cache misses and saved tag-only entries; constrained solution to removing waste from the existing release run. Fresh GitHub Actions cache behavior on a future tag remains unverified.
- 2026-09-26: T1 implementation changes both tag jobs to read-only and adds 14 focused workflow assertions; a deliberate flip back to `false` in `native` failed 2 assertions before restoration. Writer checks: focused Jest 14/14, typecheck and touched-file ESLint pass. Parent spot-check: focused Jest 14/14. Independent verification: `npx lefthook run pre-commit` passed (187 suites, 1618 tests; native hook skipped because no native source/fixture staged), staged diff unchanged, `git diff --cached --check` passed. A read-only native risk assessment was unassessable due to untracked new files, so independent verification was required and completed. Corrected C5 to distinguish the 30m01s APK build **step** from the 30m43s build **job**. Runtime harness: N/A because a new tag would trigger a remote release. Exact future CI speedup is unmeasured; the observed avoidable uploads were 2.32 GB + 1.98 GB on v1.7.0.

Next: wait for a separately authorized future release before measuring actual CI time saved; this task does not trigger one.
