# CLAUDE.md

## Read before planning or coding

This project follows Spec-Driven Development (SDD), but architecture drift between docs, OpenSpec artifacts, and the actual filesystem layout can occur. Always verify the current state before making assumptions.

### CRITICAL ARCHITECTURE CONSTRAINTS (DO NOT IGNORE)

1. **Dumb UI Rule**: Files with `.tsx` extensions MUST only return JSX and use HeroUI Native primitives + Tailwind classes (`cn()`). ZERO business logic, no `useEffect`, and no database calls are allowed in `.tsx` files.
2. **Hook Anatomy Rule (10 Steps)**: Custom hooks (`use-*.ts`) MUST follow this strict top-to-bottom order: Imports -> Signature -> 1. Refs -> 2. State -> 3. Context/3rd Party Hooks -> 4. Queries/Mutations -> 5. Derived State (`useMemo`) -> 6. Callbacks (`useCallback` calling pure helpers) -> 7. Effects -> Return.
3. **Strict Colocation**: Each complex feature UI must be an independent folder with an `index.ts` (public contract), `.tsx` (UI), `use-*.ts` (Logic), `*.helpers.ts` (Pure functions), and an isolated `__tests__/` folder.
4. **TDD Mandate**: You are PROHIBITED from modifying or creating a helper or hook without first creating or updating its corresponding test file in the `__tests__/` directory. 
5. **The 500-Line Rule**: If any file exceeds 500 lines, it must be refactored immediately (extract into sub-components or use Facade Hooks).
6. **Reference Feature**: If in doubt about how to structure code, look at the `src/features/animes` directory as your ABSOLUTE SOURCE OF TRUTH.
7. **Scaffolding Generators**: NEVER create feature folders manually. You MUST use `npm run generate:feature <name>` to scaffold new components.

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

- **HeroUI Native es la librería de UI principal del proyecto**. Todos los componentes de interfaz DEBEN usar primitivas de HeroUI Native (`Button`, `Card`, `Chip`, `Tabs`, `Alert`, `TextField`, `Input`, `Label`, `Spinner`, `Badge`, `Divider`, `Switch`, `Avatar`, `Progress`, `Text`, etc.) en lugar de primitivas crudas de React Native (`TouchableOpacity`, `TextInput`, `Pressable`).
- Usar `cn()` de `heroui-native` para composición de clases Tailwind.
- Usar `useThemeColor()` de `heroui-native` para acceder a colores del tema dinámicamente.
- Los componentes wrapper (`AppText`, `ScreenScrollView`) existen para funcionalidad adicional (accesibilidad, safe areas), NO como reemplazo de HeroUI Native.
- Nunca usar `StyleSheet.create()` para estilos que se puedan resolver con clases Tailwind/Uniwind.

### Practical Warning

Do not assume a specific architecture pattern (e.g., standard clean architecture or specific state management) without checking the code first. Always start your context gathering by reading core entry points and main configuration files.
