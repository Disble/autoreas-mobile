# Lint / Pre-commit Cleanup Plan — Phase 2

Current worktree reviewed on 2026-07-17, branch `fix/background-sync-execution`.

## Validated current state

| Check | Command | Result |
|---|---|---|
| ESLint | `bun run lint` | **exit 0** — no warnings |
| Fallow audit | `bun run audit` | **exit 0** — no dead exports; 2 complexity findings and 70 large functions remain informational |

Phase-1 outcome: S1/S2 (barrel imports), S3 (useMemo), S4 (derived state), S5 (async/iteration), S6 (AppRootLayout exports), and S7 (dependencies) are complete. S9 and S10 are complete in the current worktree.

**Correction from phase 1:** unused exports set `dead_code_has_errors: true` and fail the audit even with `introduced: false`. S9 removed the seven failing exports.

## Global rules for every slice (paste into each executor prompt)

1. Work ONLY on the files listed in your slice.
2. After changes run, in order: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run audit`. No new findings allowed.
3. CLAUDE.md constraints apply: TDD mandate (update `__tests__` first when touching helpers/hooks), `.tsx` = JSX only, 500-line rule.
4. No behavior changes. Conventional commit, no AI attribution.

---

## Slice S9 — Remove dead bootstrap-strategy cluster (COMPLETE)

Fallow reports 7 exported symbols with zero consumers (verified by repo-wide grep: no references in `src/` or `tests/` outside their own files).

**File `src/features/sync/sync-facade.helpers.ts` (6 findings — a dead call chain):**

- `:32 resolveBootstrapMode` — fully dead (declaration is its only reference)
- `:40 resolveBootstrapStrategy` — fully dead; it is the ONLY caller of the two strategies below
- `:48 runHydrationBootstrapStrategy` — called only by `resolveBootstrapStrategy` (dead)
- `:58 runReconcileBootstrapStrategy` — called only by `resolveBootstrapStrategy` (dead)
- `:70 adaptAsyncSyncToVoidHandler` — fully dead
- `:155 buildLocalAnimePresenceQuery` — fully dead

Steps:
1. Delete all six functions (the whole cluster is dead — likely orphaned by the foreground-sync refactor on this branch).
2. After deleting, check whether types they used (`SyncBootstrapMode`, `SyncBootstrapStrategy`) and any imports become unused — remove those too if so.
3. The file HAS live exports (`runCoordinatedForegroundSyncCycle`, `buildPendingOperationsQuery`, `buildUnresolvedSeasonRatingQuery`, …) and live tests (`tests/features/sync/sync-facade.helpers.test.ts`, `sync-facade-failure-precedence.test.ts`). Do NOT touch the live code. The existing tests contain no references to the dead symbols, so no test edits should be needed — if a test breaks, STOP and reassess (a symbol was not dead).

**File `src/features/animes/anime-mutation.helpers.ts` (1 finding):**

- `:24 fetchParsedAnime` — used once INSIDE the same file. Fix = remove only the `export` keyword, keep the function.

CAUTION: if the intent of the current branch is that some of this bootstrap cluster SHOULD be wired up (it looks like an unfinished strategy pattern), confirm with the repo owner before deleting. Default action per "code is law": delete dead code.

Result: `bun run audit` exits 0.

## Slice S10 — Set lookup in anime-season helpers (COMPLETE)

- `src/features/animes/anime-season.helpers.ts:31` — `react-doctor/js-set-map-lookups`: `array.includes()` inside a loop. Fix = build `const xSet = new Set(array)` once before the loop and use `xSet.has(...)`. Pure function change — update `tests/features/animes/` coverage for this helper FIRST if behavior-visible (it should not be).

Result: the `anime-season.helpers.ts` warning is resolved. The subsequent barrel-import warning in `src/features/sync/headless-sync-cycle.helpers.ts` is also resolved; `bun run lint` exits with no warnings.

## Slice S11 — Migrate formerly colocated tests (COMPLETE)

**Finding:** `jest.config.js` limits Jest to `tests/`. The config-aligned migration is complete: formerly colocated `src/**/__tests__/` suites were moved under `tests/features/**/__tests__/`, and `CLAUDE.md` documents that convention.

Jest reaches every retained test file through `tests/`.

## Known spec drift (out of scope)

`docs/specs/05-ui-split-screen.md:18` still requires `@shopify/flash-list`, which is absent from `package.json`. This lint-cleanup plan does not own the UI dependency decision, so the spec remains untouched. Resolve the rendering dependency in the UI-spec work before correcting that requirement.

## Backlog (unchanged, NOT blocking)

- **S8 — Large/complex functions**: fallow reports 70 functions >60 LOC and 2 complexity findings. These remain informational; `useSyncRuntime` refactor remains its own SDD change.

## Execution order

All Phase 2 slices are complete. `bun run lint` and `bun run audit` exit 0; S8 remains a non-blocking backlog item.
