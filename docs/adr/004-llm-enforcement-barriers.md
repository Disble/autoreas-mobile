# ADR 004: LLM Enforcement Barriers

## Status
Accepted

## Context
Since the project uses AI agents (LLMs) for development, we must guarantee that they do not take architectural shortcuts due to session "amnesia." Documenting conventions is not enough. We need automated barriers that throw errors if the agent attempts to deviate from the pattern or create monolithic code.

## Decision
A 4-layer strategy will be implemented to **enforce** the Strict Colocation and Dumb UI architecture on any developer (human or machine).

1. **Layer 1: Static Analysis and Strict Linter**
   * Configure **ESLint** with `max-lines` to a maximum of 500 lines for `.ts` and `.tsx` files. Force refactoring through Facade Hooks or subcomponents if exceeded.
   * Import Restrictions: A `.tsx` component **cannot** import from `src/infrastructure` or data access libraries (`drizzle-orm`). Only its folder's custom hook or repositories can do so.
   * Domain Restrictions: A file in `features/X` **cannot** internally import things from `features/Y`. The contract must be explicit via the `index.ts`.

2. **Layer 2: Generators (Automatic Scaffolding)**
   * To ensure Strict Colocation without typos or omissions, all agents and developers are required to use a generation script (e.g., `npm run generate:feature`). It is **prohibited** to create files manually for complex components.

3. **Layer 3: Transversal Documentation Protocol (`AGENTS.md`)**
   * Both `AGENTS.md` and `CLAUDE.md` will include a "CRITICAL ARCHITECTURE CONSTRAINTS (DO NOT IGNORE)" block that injects the golden rules into the agent on its "first day":
     1. Dumb UI Rule.
     2. Strict Hook Anatomy (10 Steps).
     3. Strict Colocation.
     4. TDD Mandate.
     5. Mention of the "Animes" feature as the Gold Standard reference.

## Consequences
* **Positive:**
  * Technical impossibility of breaking the architecture without the Linter failing.
  * AI Agents will correct their own deviations upon hitting CI/Lint errors.
  * Unified and unbreakable file structure through generators.
* **Negative:**
  * Greater initial time investment in configuring ESLint, Typechecking, and Bash/Node Scripts for rigorous validations.
