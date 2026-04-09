# ADR 001: Feature-Sliced Architecture and Strict Colocation

## Status
Accepted

## Context
As the application scales, organizing code by file type (e.g., `controllers/`, `views/`, `models/`) leads to low cohesion and high coupling. Modifying a feature requires navigating through multiple directories, hindering maintenance and code isolation. Furthermore, for LLM agents, having scattered context generates hallucinations and spaghetti code.

## Decision
We adopt a **Screaming Architecture** based on the concept of **Feature-Sliced Design**.
1. **Domain Grouping:** Code is organized in `src/features/`, where each folder represents a business concept (e.g., `animes/`, `sync/`).
2. **Strict Colocation:** Every complex component is treated as an independent and self-contained module. All files related to that component must live in the same folder.
   * The mandatory structure for a component is:
     * `index.ts` (Public contract, single point of export)
     * `ComponentName.tsx` (Dumb UI)
     * `use-component-name.ts` (Smart Hook)
     * `component-name.types.ts`
     * `component-name.schema.ts` (if Zod validation applies)
     * `component-name.constants.ts`
     * `component-name.helpers.ts` (Pure functions)
     * `__tests__/` (Unit and integration tests co-located with the code)

## Consequences
* **Positive:**
  * High cohesion: everything related to a component is in one place.
  * Infinite scalability: deleting a feature means deleting one folder without leaving orphan files.
  * Testability: helpers and hooks are isolated and unit-testable.
  * AI Agents have all the necessary context in a single directory.
* **Negative:**
  * Higher initial file count (boilerplate), which we will mitigate with automatic generators (Scaffolding).
