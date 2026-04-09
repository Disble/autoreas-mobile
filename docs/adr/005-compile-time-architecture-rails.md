# ADR 005: Compile-Time Architecture Rails

## Status
Accepted

## Context
Documentation and onboarding instructions are necessary but insufficient when the codebase is modified by LLM agents and newly onboarded developers. If the architectural expectations are not enforced mechanically, agents will eventually drift into shortcuts such as colocating Zod schemas inside hooks, leaving constants at the top of route files, or putting business logic inside the delivery layer.

## Decision
The project will treat architecture rules as compile-time constraints wherever possible.

1. **Delivery Layer Enforcement**
   - Files in `src/app/**` are composition-only.
   - They cannot import custom hooks, infrastructure, or React state/effect hooks.

2. **Strict Colocation Enforcement**
   - Feature `.tsx` and `use-*.ts` files cannot declare root-level constants, helper functions, interfaces, type aliases, or inline Zod schemas.
   - These concerns must live in `*.constants.ts`, `*.helpers.ts`, `*.types.ts`, and `*.schema.ts`.
   - Main feature exports must be named `function` declarations.

3. **Contract Quality Enforcement**
   - Every `*Props` interface property in `*.types.ts` must be `readonly`.
   - Every exported helper function in `*.helpers.ts` must include JSDoc.

4. **Generator Alignment**
   - The feature scaffold generator must emit code that already satisfies these rails.
   - A generator that creates invalid architecture is considered a defect in the platform.

## Consequences
* **Positive:**
  * Architectural intent becomes testable and repeatable.
  * Generic "fix lint/type errors" delegation becomes a valid architecture stress test.
  * Failures can be attributed to weak rails instead of sub-agent behavior.
* **Negative:**
  * ESLint configuration becomes more complex and must be maintained carefully.
  * Some valid edge cases may require explicit exceptions or new patterns in the future.
