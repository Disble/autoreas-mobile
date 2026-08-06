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
12. **Mutation Mandate**: Load the `mutation-tdd` skill by name after a test goes green (it is installed globally, not in this repo). Delete the guard the test claims to cover, run only that test, confirm it FAILS, then restore with `git checkout HEAD -- <file>` (plain `git checkout -- <file>` restores from the index, which silently reinstates the mutation when the file was already staged).
    - *Run one test, not the suite*: `bunx jest tests/features/sync/sync-cycle-lock.helpers.test.ts -t "reclaims an expired lock"` (~1s). `bun run test` is `jest --runInBand` over everything and is the wrong tool for this.
    - *Mandatory for*: async races and locks, defensive branches (`??` fallbacks, `if (!x) return`), `catch` blocks and timeout branches, bridge-boundary error taxonomy, and any test written to close a coverage gap.
    - *The pre-commit `test:mutation:staged` job does NOT cover this*. `scripts/dlinter-mutation-staged.mjs` protects only `src/features/sync/native-foreground-sync-ticker.helpers.ts`; outside that surface, the gate exits 0 without mutation coverage. Stryker drives this same Jest + `jest-expo` suite, so the limit is the `mutate` list in `stryker.dlinter.json`, not a runner boundary. See `ARCHITECTURE.md`'s **Incremental Mutation-Test Boundary**.
    - *Reporting*: name which guards you deleted and whether each mutant was killed. "Tests pass" is not the claim. Never report a test as covering a guard you did not break.
13. **React Doctor**: After React changes, run `npx -y react-doctor@latest . --verbose --diff`, fix every finding, and rerun it until it reports 100/100.

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

<!-- standards:v1.1.0 -->

## Engineering Principles

Twelve rules extracted from four repositories that arrived at the same thesis
independently: **a rule that only exists in prose does not exist.** Each one is
referenced by ID. To depart from one, write `deviates: Pnn — reason` in this
file's repo-owned section; silence is drift, a stated deviation is a decision.

### Governance of the rules themselves

**P01 — Every prose rule needs a machine owner.** If a convention cannot be
expressed as a lint rule, a test, or a gate job, it is a wish. Write the
enforcement first; prose explains the why behind it.

**P02 — Respect upstream triage, and lock it with a drift test.** A bundled
plugin's per-rule severities are its author's judgment. Override named rule IDs
only, each with a recorded reason. Then snapshot the plugin's error-set to a
contract test, so a version bump that re-triages a rule fails loudly instead of
shifting the gate in silence. Blanket-downgrading a ruleset throws away the exact
work the preset exists to do.

**P03 — Thresholds and exclusions carry their evidence inline.** Record the
measurement in the comment beside the number. An unexplained ignore entry is
indistinguishable from a shortcut, and gets deleted or copied for the wrong
reasons.

**P04 — Rank levers by gaming resistance.** Cognitive complexity has no escape by
relocation, so it is a strong lever. File size is defeated by sharding one file
into two, so it is never the headline. Know which rules actually hold.

**P05 — Baselines are debt with an expiry.** A baseline entry is an active
exception that must shrink and disappear. The healthy state of a baseline file is
empty. Treat a permanent entry as a permission slip that was never granted.

### Gates

**P06 — One entrypoint, and its verdict equals the cloud's.** A single hook
config with no shell orchestration around it, running what CI runs. A local
threshold looser than the cloud's makes local green a lie.

**P07 — Prove the gate's failure path.** Stage a deliberately broken file, run the
hook, assert it fails, clean up. A gate nobody has watched fail is unproven.

**P08 — Marker-comment ownership for generated config.** Anything a tool owns sits
behind a marker comment and is re-merged additively. Everything outside the
markers is repo-owned and survives every update.

### Tests

**P09 — Mutate, don't trust coverage.** RED → GREEN → MUTATE → REFACTOR. Delete
the guard a test claims to cover, run only that test, confirm it fails, restore.
A test that passes with its guard deleted proves nothing, and neither the suite
nor the coverage number will tell you. **Tests own behavior scenarios, never
mutants** — a suite written one test per surviving mutant mirrors the
implementation instead of the behavior it exists to protect. Strengthen the
scenario that already owns the outcome before adding a new test.

**P10 — State the boundary a guard does not cover.** Name what the check cannot
see, in the place someone will look. A guard whose limits are unstated will be
mistaken for a complete one. This applies to the harness as a whole: raising the
cost of a shortcut is worth shipping, and claiming it is impossible is not.

### Platform and knowledge

**P11 — Generators are platform, not convenience.** Never hand-scaffold what a
generator owns. A generator that emits structure the linter rejects is a platform
defect, never a user error.

**P12 — Keep an append-only why-log.** One dated line per non-obvious lesson,
newest at the bottom, never rewritten. A lesson that does not fit on one line has
not been extracted yet — that is an investigation, and it belongs in an ADR or a
postmortem with a one-line pointer from the log. The log complements deterministic
guards and never replaces them: enforce the rule in code first, record the why
second.

<!-- /standards -->

<!-- standards:ladder:v1.0.0 -->

## Enforcement Ladder

Every control in this repo sits on one of nine rungs. Each has a distinct owner
and a distinct failure mode. When adding a guard, name its rung first — two
guards on the same rung usually means one of them is redundant, and a rung with
nothing on it is where the next defect gets through.

| Rung | Control | Catches | Force |
|---|---|---|---|
| L0 | Agent doctrine — this file | The rule was never known | advisory |
| L1 | Architecture rails — lint rules, import contracts | Layer violations, misplaced declarations | blocking |
| L2 | Graph analysis — dead code, duplication, cycles, deps | Rot the compiler accepts | blocking |
| L3 | Test discipline — RED → GREEN → MUTATE → REFACTOR | Tests that pass with the guard deleted | prompt-driven |
| L4 | Local gate — one hook entrypoint | Everything above, before it enters history | blocking |
| L5 | Gate verification — prove the failure path | A gate that silently stopped enforcing | blocking |
| L6 | Cloud parity — CI, quality gate, drift contracts | Local green that is a lie | blocking |
| L7 | Agent-side gate — tool hook wrapping commit/push | An agent committing around the local gate | blocking |
| L8 | The why-record — ADRs, learning log | Rediscovering a solved problem | human process |

Two rules about the ladder itself:

**Advisory rungs stay advisory.** L0 and L8 carry judgment, and a gate that
blocks on documentation makes deleting the entry the cheapest way to commit —
which destroys the record it was meant to protect. Never promote them.

**L5 is the rung most often missing.** A gate nobody has watched fail is
indistinguishable from no gate at all.

<!-- /standards:ladder -->

<!-- standards:gate:v1.0.0 -->

## Gate Contract

**One entrypoint.** The hook config is the single place the local gate is
declared. No shell orchestration wrapped around it, no second script that runs
"the other checks". A reviewer asking "what blocks a commit here" reads one file.

**The local verdict equals the cloud's.** Any threshold looser locally than in
CI makes local green a lie, and the lie is discovered at the least convenient
moment. When a cloud gate flags something the local gate permits, tighten the
local one.

**The failure path is proven.** Stage a deliberately broken file, run the hook,
assert it fails, clean up. Keep that check runnable. A gate nobody has watched
fail is unproven, and gates fail silently far more often than they fire wrongly.

**The gate is slow by design — budget for it.** Give `git commit` a generous
command timeout so it is never killed mid-hook. A killed commit leaves changes
staged and unrecorded: re-run the commit. Never pass `--no-verify`.

**Suppressions are reviewable sentences.** Every inline suppression names the
specific rule and explains itself in prose. Silent suppression becomes a visible
diff a reviewer can catch.

**Weakening a threshold is a decision, not a fix.** Raising a limit or excluding
a path to make a finding disappear is the cheapest available action and almost
never the right one. If it is right, the reason goes in the config beside the
number.

<!-- /standards:gate -->

<!-- standards:threat:v1.0.0 -->

## What This Harness Does Not Guarantee

Every machine-checked rule here constrains code only while the rule stays in
place. A rule can be satisfied by removing it: widening a threshold, dropping a
linter from the enabled set, adding a suppression, excluding a path. Each is a
one-line change, cheaper than the refactor the rule was trying to force.

**A linter cannot police the config that configures it.** Any meta-check lives in
the same mutable tree, editable by the same actor with the same one-line change.
Shipping a partial mechanism here would imply a guarantee that cannot be made.

What this harness actually buys: defeating it is no longer free or silent. Every
threshold sits in one small reviewable file, and every suppression must name its
rule and explain itself in English. A reviewer checking whether anyone weakened
the cage has a short list of places to look.

The credible controls are external and belong to the repository's settings:
CODEOWNERS on the config files, branch protection requiring review, and a CI
check that fails a pull request when a threshold moves in the permissive
direction without a written justification.

**This raises the cost and visibility of cheating. It does not make cheating
impossible.** State the limit rather than decorating it — a guard whose
boundaries are unstated will be mistaken for a complete one.

<!-- /standards:threat -->

<!-- standards:profile:ts-react:v1.1.0 -->

## Stack Profile — TypeScript + React

**Architecture rails (L1).** `dlinter-ts-react` via `createRecommendedConfig()`.
Presets are named after architecture CONCEPTS, never after the consuming project;
project specifics are rule OPTIONS. Spread the recommended config first, then
append project blocks so later entries win where rules overlap.

**Severity policy — the one that is easiest to get wrong.** Bundled plugins keep
their author's per-rule severities as-is. Override named rule IDs only, each with
a reason recorded beside it in source. A blanket downgrade throws away the
per-rule triage the preset exists to deliver. Lock every spread plugin to an
exact version and snapshot its error-set to a contract test, so a bump that
re-triages a rule fails loudly. "It is a heuristic" and "it is awkward in JSX" do
not qualify as reasons.

**Graph analysis (L2).** `fallow audit` as the changed-code gate. Set the
duplication `minOccurrences` to match whatever the cloud quality gate flags — if
the cloud catches pair clones, 3 makes local green a lie. Baseline legacy clone
groups so the audit fails only on new duplication, and treat the baseline as debt
with an expiry.

**Colocation.** Each complex module is a folder: `.tsx` for dumb UI, `use-*.ts`
for logic, `*.helpers.ts` for pure functions, `*.types.ts`, `*.constants.ts`,
optional `*.schema.ts`, and a colocated `__tests__/`. Feature `.tsx` and
`use-*.ts` files carry no root-level constants, helpers, interfaces, type
aliases, or inline schemas — the linter enforces this, so a violation is a build
failure rather than a review comment.

**Barrels.** Import modules by concrete path. Measured on a real 568-file
frontend: 62% of cross-module imports already bypassed the barrel and 40 of 67
barrels had zero production importers, so the barrel was cost without benefit.
A generator that manufactures an unused barrel per module is a platform defect.
Note that ESLint alone cannot guard this — under bundler module resolution a
re-created `index.ts` plus a directory import resolves cleanly and no rule sees
it, so the guard is a filesystem check.

**Type-checked linting.** Enable the type-checked tier on source and exempt
tests. Virtual-file lint tests cannot exercise typed rules; prove typed behavior
against a real fixture project instead.

<!-- /standards:profile:ts-react -->

<!-- standards:mutation:automated:v1.1.0 -->

### Mutation (L3)

The cycle is RED → GREEN → **MUTATE** → REFACTOR. **Load the `mutation-tdd` skill
before acting on any mutation result** — it owns the decision table, the
survivor-triage rules, and the equivalent-mutant discipline.

**Automated on one file.** ``bun run test:mutation:staged`` runs Stryker over the staged diff, config
at `stryker.dlinter.json`. Stryker drives the project's own Jest + `jest-expo` suite via
`@stryker-mutator/jest-runner` — mutants are judged by the same tests that run in `bun run test`,
not by a separate mutation suite.

**It covers the added lines of `src/features/sync/native-foreground-sync-ticker.helpers.ts` and nothing else.** The limit is now the `mutate` list, not a runner boundary. Outside that surface the job exits zero
with no mutation coverage. An unstated limit gets read as full coverage.

**The runner is incremental — force a fresh run when tests changed.** A cached
result computed against the previous test suite will report mutants as killed
that the current suite no longer kills.

**Every other surface uses the manual check.** Delete the guard, run only that
test, confirm it FAILS, restore with `git checkout -- <file>`. Run the single
test, never the suite.

**Report the mutated scope, the survivors and their dispositions, and the
cache mode.** "Tests pass" is not the claim, and neither is a score.

<!-- /standards:mutation:automated -->

## Standards Coverage and Deviations

Departures from the blocks above, each with its reason. Silence means the repo
follows the principle as written.

- `deviates: profile ts-react, barrel clause — this repo mandates barrels.`
  ADR-001 requires an `index.ts` public contract per module, and
  `.fallowrc.json` carries `ignoreExports` and an `unused-types: off` override to
  keep them from reading as dead code. The sister desktop repo measured the
  opposite and banned them (62% of cross-module imports already bypassed the
  barrel; 40 of 67 had zero production importers) in its ADR-011. That evidence
  is not disputed here — the migration is simply pending, and this line exists so
  the gap is a recorded decision rather than silent drift.
- `deviates: P06 — there is no cloud verdict to match.` `.github/workflows/` does
  not exist. The entire gate is local, so nothing independently re-checks a
  commit and the "local green equals cloud green" clause has no counterpart.
- **Satisfies P07, alone among these repos.**
  `scripts/verify-precommit-fail-path.mjs` stages a deliberately broken file,
  runs the hook, asserts it fails, and cleans up — wired as
  `bun run verify:precommit-fail-path`. The ladder calls L5 the rung most often
  missing; it is present here and absent in the other three.
