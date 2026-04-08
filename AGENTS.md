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

## Documentation References & Source of Truth

- **Verify Before Assuming**: Do not assume the documented target architecture already exists in code. Verify against the filesystem and runtime wiring first.
- **Code vs Docs Conflict**: If docs, specs, or archived changes conflict with the code, treat the **codebase** as the runtime truth. Document the drift explicitly before planning the fix.
- **SDD Main Specs**: The main source of truth for SDD lives in the `openspec/specs/` folder (or equivalent active specs directory). However, specs may overstate completion if not reconciled with the codebase.
