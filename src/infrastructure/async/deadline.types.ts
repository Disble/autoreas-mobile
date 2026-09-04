/** One bounded operation: what to run, how long it may take, and what to call it in a failure. */
export interface WithDeadlineParams<TValue> {
  readonly operation: () => Promise<TValue>;
  readonly timeoutMs: number;
  readonly label: string;
}
