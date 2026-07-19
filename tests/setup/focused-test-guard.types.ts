/** Represents a focused Jest API replacement that always aborts execution. */
export type FocusedTestGuard = (...args: readonly unknown[]) => never;
