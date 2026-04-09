# ADR 003: Testing Policy, TDD Powered by SDD

## Status
Accepted

## Context
In a team where LLM agents and human developers participate, we cannot rely on manual code reviews alone for quality assurance. We need an unbreakable safety net. Furthermore, we adopted the **Spec-Driven Development (SDD)** approach, which provides business specifications upfront.

## Decision
Our testing policy focuses on **TDD (Test-Driven Development)** mandated by the presence of specifications (SDD) and a testing pyramid adapted to React Native.

1. **Mandatory TDD + SDD Flow:**
   1. Read spec (`openspec/specs/`).
   2. Write the test validating the spec (Fails - Red).
   3. Write the minimal code (Passes - Green).
   4. Refactor respecting the architecture.
   *NOTE:* Business logic PRs without tests are prohibited.

2. **Testing Pyramid:**
   * **Pure Logic (`.helpers.ts`, `.schema.ts`):** 100% coverage. Isolated unit tests with Jest/Vitest. (The most valuable).
   * **Custom Hooks (`use-*.ts`):** 85%+ coverage. Integration tests, testing state transitions, mocking the database (Drizzle/SQLite).
   * **Dumb Components (`.tsx`):** Cover only logical behavior and accessibility (rendering conditionals). Do not force 100% line coverage if it is purely visual UI.
   * **E2E (Maestro/Detox):** Only for 3 or 4 critical business flows.

3. **Colocated Testing Location:**
   All tests reside in the `__tests__/` folder immediately next to the file being tested (`src/features/X/ui/Comp/__tests__/`).

## Consequences
* **Positive:**
  * Extreme confidence to refactor and delegate tasks to AI agents.
  * Highly maintainable code: if a feature dies, its tests die with it.
  * Focus on critical business parts (helpers and hooks) and not on testing if a color was applied correctly.
* **Negative:**
  * Initial development time cost. (Fully amortized by the absence of bugs in production).
