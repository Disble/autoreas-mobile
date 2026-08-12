# CLAUDE.md

## Read before planning or coding

This project follows Spec-Driven Development (SDD), but architecture drift between docs, OpenSpec artifacts, and the actual filesystem layout can occur. Always verify the current state before making assumptions.

### CRITICAL ARCHITECTURE CONSTRAINTS (DO NOT IGNORE)

1. **Dumb UI Rule**: Files with `.tsx` extensions MUST only return JSX and use HeroUI Native primitives + Tailwind classes (`cn()`). ZERO business logic, no `useEffect`, and no database calls are allowed in `.tsx` files.
2. **Hook Anatomy Rule (10 Steps)**: Custom hooks (`use-*.ts`) MUST follow this strict top-to-bottom order: Imports -> Signature -> 1. Refs -> 2. State -> 3. Context/3rd Party Hooks -> 4. Queries/Mutations -> 5. Derived State (`useMemo`) -> 6. Callbacks (`useCallback` calling pure helpers) -> 7. Effects -> Return.
3. **Strict Colocation**: Each complex feature UI must be an independent folder with an `index.ts` (public contract), `.tsx` (UI), `use-*.ts` (Logic), and `*.helpers.ts` (Pure functions). Tests are NOT colocated in `src/` — Jest only runs suites under `tests/` (`jest.config.js` `roots`), so every test lives under `tests/features/<feature>/__tests__/`, mirroring the feature path (e.g. `tests/features/animes/__tests__/anime-season.helpers.test.ts` covers `src/features/animes/anime-season.helpers.ts`).
4. **TDD Mandate**: You are PROHIBITED from modifying or creating a helper or hook without first creating or updating its corresponding test file under `tests/features/<feature>/__tests__/`. **The cycle here is RED → GREEN → MUTATE → REFACTOR** — see constraint 9.
5. **The 500-Line Rule**: If any file exceeds 500 lines, it must be refactored immediately (extract into sub-components or use Facade Hooks).
6. **Reference Feature**: If in doubt about how to structure code, look at the `src/features/animes` directory as your ABSOLUTE SOURCE OF TRUTH.
7. **Scaffolding Generators**: NEVER create feature folders manually. You MUST use `npm run generate:feature <name>` to scaffold new components.
8. **Bridge Boundary Rule**: ALL communication with `autoreas-bridge` (HTTP + WebSocket) MUST go through the `BridgeClient` adapter in `src/infrastructure/api`. Feature code is FORBIDDEN from calling `fetch()`, instantiating `new WebSocket(...)`, or building raw `http(s)://`/`ws(s)://` URLs — consume `bridgeClient` instead; only `src/infrastructure/api/**` may own transport. This is the barrier that stops a scattered-connection regression from happening again. **⚠️ THIS RULE IS CURRENTLY A CONVENTION, NOT ENFORCED — treat it as your own responsibility.** Measured 2026-08-12: a file under `src/features/**` calling `fetch('https://…')` and `new WebSocket('wss://…')` passes `npx eslint` completely clean, exit 0, zero errors. The hand-rolled `no-restricted-syntax` selectors this rule used to name were deleted, and `dlinter-ts-react`'s `infrastructure` edge cannot replace them: it governs **import specifiers**, but `fetch` and `WebSocket` are React Native **globals** that are never imported, so an import-based rule can never see them. Restoring enforcement means adding a dedicated `no-restricted-syntax` block to `eslint.config.mjs`, exactly like the Write Door rule already there — see `ARCHITECTURE.md`'s **LLM Enforcement Barriers**.
9. **Mutation Mandate**: Load `mutation-tdd` after a test goes green. The safe cycle is **stage first, then mutate**: (1) `git add <file>` while the feature is still green — the index now holds the feature WITHOUT any mutation; (2) delete the guard the test claims to cover; (3) run only that test (`bunx jest <path> -t "<name>"`) and confirm it FAILS; (4) `git checkout -- <file>`, which restores from the *index* and so removes the mutation while keeping your uncommitted feature. **Never `git add` after mutating** — that writes the mutation into the index and step 4 would reinstate it. **Do NOT use `git checkout HEAD -- <file>` or `git restore <file> --source=HEAD` while the feature is uncommitted**: both restore from HEAD and therefore delete the entire uncommitted feature, not just the mutation (measured 2026-08-12; it destroyed work twice during the `sqlite-write-lock-contention` change). `HEAD` is only a valid source once the feature is already committed. A test that passes with its guard deleted proves nothing, and neither Jest nor the coverage number will tell you. Mandatory for async/lock tests, defensive branches, error and timeout paths, bridge-boundary error taxonomy, and any test written to close a coverage gap. **The `test:mutation:staged` pre-commit job is NOT this check** — Stryker now drives this same Jest + `jest-expo` suite, but its `mutate` list still covers only `src/features/sync/native-foreground-sync-ticker.helpers.ts`. Load the `mutation-tdd` skill by name (it is installed globally, not in this repo) and see `ARCHITECTURE.md`'s **Incremental Mutation-Test Boundary**.
10. **React Doctor**: After React changes, run `npx -y react-doctor@latest . --verbose --diff`, fix every finding, and rerun it until it reports 100/100.
11. **Hook installation is a three-part invariant — do not "simplify" any part**: `package.json` must contain `trustedDependencies: ["lefthook"]` and must NOT contain `"prepare": "lefthook install"`; `docker-compose.eas.yml` must set `CI=true`. Lefthook's npm `postinstall` is the only thing that honours `CI` (the `lefthook install` command ignores it), so a `prepare` script bypasses the guard and lets the EAS Linux container — which bind-mounts `.git` via `- .:/app`, and `.dockerignore` does NOT apply to runtime mounts — rewrite the host's hooks with Linux paths. But Bun blocks dependency lifecycle scripts by default, so dropping `prepare` without `trustedDependencies` means **no hooks install at all**. The two are a pair. This matters because a clobbered hook fails **open**: its last fallback echoes "Can't find lefthook in PATH" and exits 0, so every gate stops running while still reporting success. Repair with `npx lefthook install` (`bun install` will not restore a deleted hook on an already-current tree). See `ARCHITECTURE.md` → **Hook installation is host-owned**.

### Mandatory SDD Automation Override

- The entire SDD workflow (explore -> propose -> spec -> design -> tasks -> apply -> verify -> archive) MUST run completely automatically and proactively from start to finish. THIS OVERRIDES ALL DEFAULT SKILL BEHAVIORS. You are STRICTLY FORBIDDEN from pausing to ask "should I continue?", "do you want to proceed to specs?", or waiting for approval. Present the phase summary and IMMEDIATELY trigger the next phase. Ignore simple reviews aggressively to save the user time. Ask for user input ONLY on hard, unresolvable blockers. If questions arise about preferences or past discussions, search engram memory FIRST. Execute the rest of the skills exactly as indicated but with ABSOLUTELY ZERO user intervention between phases.

### Current Runtime Truth vs Documentation Truth

- **Code is Law**: If docs, specs, or archived changes disagree with the code, the **codebase** wins as the runtime truth.
- **Record Drift**: Record and document architectural drift explicitly before proposing fixes or new implementations.
- **Main Specs**: Active main specs reside in the `openspec/specs/` directory. Be aware that these specs might overstate completion if they haven't been fully reconciled with the codebase yet.

### Rules for Future Agents

1. **Verify Before Coding**: Do not assume the documented target architecture already exists in code. Verify against the filesystem, components, and runtime wiring first.
2. **Delegation Guardrails**:
   - Final verification MUST be performed by the orchestrating agent itself. Do NOT delegate the `verify` phase to a sub-agent.
   - Sub-agents may still be used for other SDD phases such as proposal, spec, design, tasks, or apply.
   - When delegating `apply` or `bugfix` work, provide exact reproduction steps, acceptance (happy path) examples, and negative/rejection examples.
3. **Verification Boundary**: After `verify` passes, the orchestrating agent MUST create the commit before reporting the change as fully verified. Commit-time hooks and validations are part of the true verification boundary.

### UI Library: HeroUI Native (Mandatory)

- **HeroUI Native is the primary UI library for this project**. All interface components MUST use HeroUI Native primitives (`Button`, `Card`, `Chip`, `Tabs`, `Alert`, `TextField`, `Input`, `Label`, `Spinner`, `Badge`, `Divider`, `Switch`, `Avatar`, `Progress`, `Text`, etc.) instead of raw React Native primitives (`TouchableOpacity`, `TextInput`, `Pressable`).
- Use `cn()` from `heroui-native` for Tailwind class composition.
- Use `useThemeColor()` from `heroui-native` to access theme colors dynamically.
- The wrapper components (`AppText`, `ScreenScrollView`) exist for additional functionality (accessibility, safe areas), NOT as replacements for HeroUI Native.
- Never use `StyleSheet.create()` for styles that can be resolved with Tailwind/Uniwind classes.

### Practical Warning

Do not assume a specific architecture pattern (e.g., standard clean architecture or specific state management) without checking the code first. Always start your context gathering by reading core entry points and main configuration files.
