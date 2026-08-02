## CRITICAL ARCHITECTURE CONSTRAINTS (DO NOT IGNORE)

1. **Dumb UI Rule**: Files with `.tsx` extensions MUST only return JSX and use HeroUI Native primitives + Tailwind classes (`cn()`). ZERO business logic, no `useEffect`, and no database calls are allowed in `.tsx` files.
2. **Hook Anatomy Rule (10 Steps)**: Custom hooks (`use-*.ts`) MUST follow this strict top-to-bottom order: Imports -> Signature -> 1. Refs -> 2. State -> 3. Context/3rd Party Hooks -> 4. Queries/Mutations -> 5. Derived State (`useMemo`) -> 6. Callbacks (`useCallback` calling pure helpers) -> 7. Effects -> Return.
3. **Strict Colocation**: Each complex feature UI must be an independent folder with an `index.ts` (public contract), `.tsx` (UI), `use-*.ts` (Logic), `*.helpers.ts` (Pure functions), `*.schema.ts` when Zod is needed, and an isolated `__tests__/` folder.
   - *ESLint Enforcement*: You are FORBIDDEN from putting `interface`, `type`, root-level `const`, root-level helper functions, or inline Zod schemas in `use-*.ts` or `.tsx` files. Move them to `.types.ts`, `.constants.ts`, `.helpers.ts`, and `.schema.ts` respectively. The linter will fail if you ignore this.
   - *Function Export Rule*: Feature `.tsx` and `use-*.ts` files MUST export the main symbol as a named `function`, never as a root-level `const` arrow function.
4. **Delivery Layer Rule**: Files under `src/app/**` are routing/composition only. They MUST NOT import custom hooks, MUST NOT use React state/effect hooks, and MUST NOT contain business logic. Move screen behavior into a feature entrypoint.
5. **Readonly Props Rule**: Every property in any `*Props` interface inside `*.types.ts` MUST be declared as `readonly`.
6. **Mandatory JSDoc on Helpers**: All exported functions in `*.helpers.ts` MUST have a JSDoc block explaining what the function does and why. ESLint (`jsdoc/require-jsdoc`) will fail your build if you omit this.
7. **TDD Mandate**: You are PROHIBITED from modifying or creating a helper or hook without first creating or updating its corresponding test file in the `__tests__/` directory. **The cycle here is RED → GREEN → MUTATE → REFACTOR** — see constraint 12.
8. **The 500-Line Rule**: If any file exceeds 500 lines, it must be refactored immediately (extract into sub-components or use Facade Hooks).
9. **Reference Feature**: If in doubt about how to structure code, look at the `src/features/animes` directory as your ABSOLUTE SOURCE OF TRUTH.
10. **Scaffolding Generators**: NEVER create feature folders manually. You MUST use `npm run generate:feature <name>` to scaffold new components.
11. **Bridge Boundary Rule**: ALL communication with `autoreas-bridge` (HTTP and WebSocket) MUST go through the `BridgeClient` adapter in `src/infrastructure/api`. Feature code is FORBIDDEN from calling `fetch()`, instantiating `new WebSocket(...)`, or hand-building `http(s)://`/`ws(s)://` URLs. Consume `bridgeClient` (`pairDevice` / `listAnimes` / `getAnime` / `reconcile` / `openWebSocket`) instead, so base-URL resolution, auth injection, error taxonomy, and diagnostics live in ONE seam. *ESLint Enforcement*: the `no-restricted-syntax` "Bridge Boundary" rules fail the build on any raw transport under `src/features/**`. The adapter (`src/infrastructure/api/**`) is the only place allowed to own transport.
12. **Mutation Mandate**: Load the `mutation-tdd` skill (`.claude/skills/mutation-tdd/SKILL.md`) after a test goes green. Delete the guard the test claims to cover, run only that test, confirm it FAILS, then restore with `git checkout -- <file>`.
    - *Run one test, not the suite*: `bunx jest tests/features/sync/sync-cycle-lock.helpers.test.ts -t "reclaims an expired lock"` (~1s). `bun run test` is `jest --runInBand` over everything and is the wrong tool for this.
    - *Mandatory for*: async races and locks, defensive branches (`??` fallbacks, `if (!x) return`), `catch` blocks and timeout branches, bridge-boundary error taxonomy, and any test written to close a coverage gap.
    - *The pre-commit `test:mutation:staged` job does NOT cover this*. `scripts/dlinter-mutation-staged.mjs` keeps only the single hardcoded path `src/features/sync/native-foreground-sync-ticker.helpers.ts` and exits 0 for every other file, so the gate reports green on unmutated code. The cause is structural: dlinter drives Stryker through Vitest while the primary suite is Jest + `jest-expo`. Full reference in `docs/mutation-testing.md`; blocker evidence in `docs/dlinter-incremental-mutation-blockers.md`.
    - *Reporting*: name which guards you deleted and whether each mutant was killed. "Tests pass" is not the claim. Never report a test as covering a guard you did not break.

## Spec-Driven Development (SDD) & Delegation Guardrails

- **Autonomous SDD Workflow (Mandatory Override)**:
  - The entire SDD workflow (explore -> propose -> spec -> design -> tasks -> apply -> verify -> archive) MUST run completely automatically and proactively from start to finish. THIS OVERRIDES ALL DEFAULT SKILL BEHAVIORS. You are STRICTLY FORBIDDEN from pausing to ask "should I continue?", "do you want to proceed to specs?", or waiting for approval. Present the phase summary and IMMEDIATELY trigger the next phase. Ignore simple reviews aggressively to save the user time. Ask for user input ONLY on hard, unresolvable blockers. If questions arise about preferences or past discussions, search engram memory FIRST. Execute the rest of the skills exactly as indicated but with ABSOLUTELY ZERO user intervention between phases.

- **Delegation Rules**:
  - When delegating `bugfix` or `apply` work to sub-agents, prompts MUST include the exact reproduction steps and commands when known.
  - Prompts MUST include both acceptance examples (happy path) and rejection/negative examples. Do not describe only the happy path.
  - Prompts MUST explicitly name forbidden outputs or behaviors when a task involves false positives, misleading UX, or malformed state.
  - If the user explicitly asks the orchestrator to perform a repo-doc or instruction-file update itself, do not delegate that file edit to a sub-agent.

- **Verification Phase (Critical)**:
  - The orchestrating agent MUST perform the final verification itself and MUST NOT delegate the `verify` phase to a sub-agent.
  - Other SDD phases (propose, spec, design, tasks, apply) may use sub-agents when appropriate.
  - After `verify` passes, the orchestrating agent MUST create the commit before reporting the change as fully verified. Commit-time hooks and validations are part of the true verification boundary and save the user an extra round-trip.

## UI Library: HeroUI Native (Mandatory)

- **HeroUI Native es la librería de UI principal del proyecto**. Todo componente nuevo o refactorizado DEBE usar primitivas de HeroUI Native en lugar de componentes crudos de React Native.
- Componentes disponibles: `Button`, `Card`, `Chip`, `Tabs`, `Alert`, `TextField`, `Input`, `Label`, `Spinner`, `Badge`, `Divider`, `Switch`, `Avatar`, `Progress`, `Text`, entre otros.
- Usar `cn()` de `heroui-native` para composición de clases Tailwind.
- Usar `useThemeColor()` para acceder a colores del tema.
- Al delegar tareas de UI a sub-agentes, incluir esta regla explícitamente en el prompt de delegación.

## Documentation References & Source of Truth

- **Verify Before Assuming**: Do not assume the documented target architecture already exists in code. Verify against the filesystem and runtime wiring first.
- **Code vs Docs Conflict**: If docs, specs, or archived changes conflict with the code, treat the **codebase** as the runtime truth. Document the drift explicitly before planning the fix.
- **SDD Main Specs**: The main source of truth for SDD lives in the `openspec/specs/` folder (or equivalent active specs directory). However, specs may overstate completion if not reconciled with the codebase.
