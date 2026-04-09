# ADR 002: Smart Hooks, Dumb UI, and Strict Hook Anatomy

## Status
Accepted

## Context
In React, mixing API calls, business logic, and rendering in a single `.tsx` file generates components that are hard to test, bug-prone, and very difficult to reuse. LLM agents tend to group everything into a single block unless explicitly forbidden.

## Decision
Implement the **Smart/Dumb Components** pattern reinforced with **Strict Custom Hooks**.
1. **Dumb UI:** Any `.tsx` file in `features/` or `components/` must solely handle **rendering** using the **HeroUI Native** library and Tailwind classes (`cn()`). They are prohibited from using `useEffect`, repository calls, or handling complex data transformation logic.
2. **Smart Hooks:** All logic resides in an associated `use-component-name.ts` file.
3. **Strict 10-Step Anatomy for Hooks:**
   To standardize the code, all custom hooks must follow this top-to-bottom order:
   1. Imports (External, then Internal, then Local)
   2. Hook Signature (`export const useSomething = () => {`)
   3. 1st - Initialization and Refs (`useRef`)
   4. 2nd - Local State (`useState` or `useReducer`)
   5. 3rd - Third-Party/Context Hooks (`useThemeColor`, `useForm`)
   6. 4th - Mutation/Query Hooks (Repository calls)
   7. 5th - Derived State (`useMemo`)
   8. 6th - Functions/Callbacks (`useCallback` - calling pure helpers)
   9. 7th - Effects (`useEffect` - as a last resort)
   10. Return (Plain object or tuple)

## Consequences
* **Positive:**
  * Extremely clear separation of concerns.
  * Brutal ease in testing business logic without mounting the UI.
  * Predictable code. Any developer (or AI) opening a hook will know exactly where to find each type of declaration.
* **Negative:**
  * Initial learning curve to respect the 10-step convention.
