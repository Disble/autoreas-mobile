# CLAUDE.md

## Read before planning or coding

This project follows Spec-Driven Development (SDD), but architecture drift between docs, OpenSpec artifacts, and the actual filesystem layout can occur. Always verify the current state before making assumptions.

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

### Practical Warning

Do not assume a specific architecture pattern (e.g., standard clean architecture or specific state management) without checking the code first. Always start your context gathering by reading core entry points and main configuration files.
