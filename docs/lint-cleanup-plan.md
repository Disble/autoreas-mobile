# Lint / Pre-commit Cleanup Plan — autoreas-mobile

> **STATUS (2026-07-17): PHASE 2 COMPLETE.** The worktree has completed S9, S10, and S11: `bun run audit` exits 0, `bun run lint` exits cleanly with no warnings, and formerly colocated tests have been migrated under `tests/`. See `docs/lint-cleanup-plan-phase2.md` for the completed migration and the unrelated FlashList spec drift.

Measured on 2026-07-17, branch `fix/background-sync-execution`.

## Measured baseline (run these to reproduce)

| Check | Command | Result |
|---|---|---|
| ESLint | `bun run lint` | 44 warnings, 0 errors |
| Typecheck | `bun run typecheck` | clean |
| Tests | `bun run test` | 527 passing (89 suites) |
| Fallow audit | `bun run audit` | **exit code 1** — 18 dead-code issues (2 unused exports + 16 unused deps), 3 complexity findings, 31 large functions (informational) |

**The actual pre-commit blocker is `fallow audit` (exit 1).** ESLint emits warnings only (exit 0). The perceived "200+ problems" is the sum of ESLint warnings + fallow findings + fallow's informational large-function list.

ESLint warning breakdown (all from `react-doctor` plugin):

- 26 × `no-barrel-import`
- 5 × `async-await-in-loop`
- 4 × `no-usememo-simple-expression`
- 2 × `server-sequential-independent-await`
- 2 × `js-set-map-lookups`
- 2 × `js-combine-iterations`
- 1 × `no-event-handler`, 1 × `no-derived-state`, 1 × `no-derived-state-effect`

## Global rules for every slice (paste into each executor prompt)

1. Work ONLY on the files listed in your slice. Do not touch anything else.
2. After changes run, in order: `bun run lint`, `bun run typecheck`, `bun run test`. All must pass with no NEW warnings.
3. Project constraints (from CLAUDE.md): `.tsx` files are JSX-only (no logic/useEffect); hooks follow the 10-step anatomy order; if you modify a helper or hook, update its test in `__tests__/` FIRST (TDD mandate); files must stay under 500 lines.
4. Do not change any public behavior. These are lint fixes, not refactors.
5. Conventional commit, no AI attribution. One commit per slice.

Slices are content-independent (disjoint findings) but S1 and S5 touch some of the same sync files — run them sequentially or rebase, don't run in parallel.

---

## Slice S1 — Barrel imports, `sync` feature (17 warnings, mechanical)

**Rule:** `react-doctor/no-barrel-import`. Fix = change imports that point to an `index.ts` (e.g. `from "../ws"` or `from "./index"`) to import directly from the concrete source file that defines the symbol (e.g. `from "../ws/use-websocket"` — open the index file, see where each symbol is re-exported from, import from there).

**Files (all under `src/features/sync/`):** `full-resync.helpers.ts`, `reconcile.helpers.ts`, `remote-change-drain.helpers.ts`, `season-mode-sync.helpers.ts`, `season-rating-queue.helpers.ts`, `season-sync.helpers.ts`, `sqlite-sync-runtime.helpers.ts`, `sync-facade.helpers.ts`, `sync-runtime-status.helpers.ts`, `use-foreground-resync.ts`, `use-initial-sync.ts`, `use-remote-change-drain.ts`, `use-season-mode-sync.ts`, `use-season-sync.ts`, `use-sync-facade.ts`, `use-sync-runtime.ts`.

Import-line-only changes; no test updates needed. Accept: zero `no-barrel-import` warnings in these files.

## Slice S2 — Barrel imports, remaining files (9 warnings, mechanical)

Same rule and fix as S1. **Files:**

- `src/features/animes/anime-mutation.helpers.ts`, `use-anime-list.ts`, `use-mutate-anime.ts`, `use-season-rating-intent.ts`
- `src/features/settings/use-background-sync-status.ts`, `use-bridge-config.ts`
- `src/features/setup/use-pair-device.ts`, `use-sqlite-unavailable-message.ts`
- `src/features/ws/use-websocket.ts`
- `src/infrastructure/db/client/client.helpers.ts`

## Slice S3 — Trivial `useMemo` removals (4 warnings, low risk)

**Rule:** `no-usememo-simple-expression`. Fix = delete the `useMemo(...)` wrapper and keep the plain expression; remove `useMemo` from imports if now unused. Update the hook's test first if it asserts on memoization (it likely doesn't).

**Locations:**

- `src/features/animes/ui/AnimeListScreen/use-anime-list-screen.ts:77`
- `src/features/animes/ui/SeasonRatingSheet/use-season-rating-sheet.ts:46`
- `src/features/setup/ui/SetupQrScanner/use-setup-qr-scanner.ts:53`
- `src/features/sync/use-sync-facade.ts:52`

## Slice S4 — Derived-state and effect-as-event-handler (3 warnings, needs judgment)

- `src/features/animes/ui/SeasonRatingSheet/use-season-rating-sheet.ts:66-67` — `no-derived-state-effect` + `no-derived-state`: `selectedRating` is stored in state and synced via `useEffect` from a prop/value. Fix: derive it directly (`const selectedRating = ...`) and keep a state override only for user edits (e.g. state holds the user's choice, display value = `userChoice ?? derivedValue`). Update `__tests__` for this hook FIRST.
- `src/features/sync/use-sync-runtime.ts:55` — `no-event-handler`: an effect watches a prop to fake an event callback. Fix: call the handler at the place the value changes (callback prop) instead of watching it in `useEffect`. CAUTION: this hook is 227 lines and central to sync — make the minimal change; if the fix requires restructuring, instead add `// eslint-disable-next-line react-doctor/no-event-handler -- <one-line reason>` and note it for the S8 refactor.

## Slice S5 — Async/iteration performance warnings (11 warnings, HIGH CAUTION)

**CRITICAL CAUTION:** these are sync/SQLite code paths. Sequential `await` in a loop is often INTENTIONAL (write ordering, transaction safety, operation-log ordering). For each finding, first decide: are the awaited operations truly independent (read-only, no ordering contract)? If independent → parallelize with `Promise.all`. If NOT independent or unsure → keep the code and add `// eslint-disable-next-line react-doctor/<rule> -- sequential by design: <reason>`. When in doubt, suppress rather than parallelize. Update the matching test file first for any behavioral change.

**Locations (relative to `src/features/sync/`):**

- `full-resync.helpers.ts:52` (sequential-await), `:63` (await-in-loop)
- `initial-sync.helpers.ts:52`, `:80` (await-in-loop)
- `merge/apply-remote-changes.helpers.ts:74` (await-in-loop) — almost certainly ordered writes → suppress
- `operation-log-retention.helpers.ts:135` (sequential-await)
- `season-rating-queue.helpers.ts:285` (await-in-loop)
- `reconcile.helpers.ts:75`, `:285` (combine-iterations — safe single-pass rewrite), `:287` (set-lookups — safe, build a `Set` before the loop)
- one more `js-set-map-lookups` in the same area (see `bun run lint` output)

## Slice S6 — Fallow unused exports (2 findings, small)

- `src/features/setup/ui/AppRootLayout/app-root-layout.constants.ts:2` — `AppRootLayoutDefaultLabel`
- `src/features/setup/ui/AppRootLayout/app-root-layout.startup.ts:4` — `prepareAppRootLayoutSplashScreen`

CAUTION: both are in files currently modified on branch `fix/background-sync-execution` (uncommitted work). Check `git status` / recent edits first — they may be about to gain consumers. If genuinely unused: remove the `export` keyword (if used internally) or delete the symbol + its test references. Accept: `bun run audit` no longer lists unused exports.

## Slice S7 — Unused dependencies (16 findings — THE pre-commit blocker)

Fallow flags 16 `package.json` dependencies as never imported. Pre-verified classification (2026-07-17):

**Safe to remove** (no imports in `src/`, not in `app.json` plugins):
`@shopify/flash-list`, `clsx`, `expo-blur`, `expo-glass-effect`, `expo-linear-gradient`, `expo-symbols`, `react-native-webview`

**Keep — used indirectly; add to fallow ignore list instead:**

- `expo-build-properties`, `expo-web-browser` — listed as plugins in `app.json`
- `@react-navigation/bottom-tabs` — runtime requirement of expo-router `Tabs` (used in `src/app/(tabs)/_layout.tsx`)
- `@react-native-masked-view/masked-view` — react-navigation peer dependency
- `react-native-web` — `app.json` declares a `web` platform section
- `expo-dev-client` — dev-build workflow (project uses `expo start` dev client)

**Verify then decide:**

- `expo-updates` — no `updates` key in app.json; check `eas.json`/native config before removing (removal changes native build)
- `expo-system-ui` — often required when `userInterfaceStyle` is set in app.json; check
- `prettier-plugin-tailwindcss` — no prettier config file found; check editor/format tooling before removing

Mechanics: remove deps with `bun remove <pkg>`; for keepers, add them to fallow's ignore config (check `fallow.config.*` / `package.json` "fallow" key; docs: https://docs.fallow.tools — key is typically `ignoreDependencies`). Accept: `bun run audit` exits 0, app still starts (`bun run android` smoke check), tests pass.

**This slice alone unblocks pre-commit.** Do it first if the goal is committing quickly.

## Slice S8 (backlog, NOT lint-blocking) — Large/complex functions

Fallow lists 31 functions >60 LOC (mostly test arrow bodies) and flags `useSyncRuntime` (227 lines, 25 hooks, cognitive 26) in `src/features/sync/use-sync-runtime.ts:28`. These are informational and do not fail the audit. Refactoring `useSyncRuntime` into facade sub-hooks is a real design change — run it as its own SDD change, not as a lint slice.

## Suggested execution order

S7 (unblocks pre-commit) → S6 → S1 → S2 → S3 → S4 → S5. S1–S4 and S6 are fully parallelizable across different executors; S5 must not run concurrently with S1.
