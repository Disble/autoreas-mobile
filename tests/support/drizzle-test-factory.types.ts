/**
 * `node:sqlite` statement surface the drizzle proxy relies on. `setReturnArrays` is what makes
 * the proxy work without any hand-rolled column-ordering logic, and it is absent from the
 * published typings, so it is declared here rather than cast at each call site.
 */
export interface PositionalStatement {
  setReturnArrays: (enabled: boolean) => void;
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => unknown;
}
