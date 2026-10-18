/**
 * Numbers the bridge requests of one sync cycle, so each request's `X-Autoreas-Request-Id` joins
 * a phone log line to the bridge's record of the same request. One sequence is shared, by
 * reference, by every step of the cycle: copying it would restart the count.
 */
export interface RequestIdSequence {
  /** The cycle's id, a lowercase UUID: the prefix every request of the cycle shares. */
  readonly cycleId: string;
  /** Returns `<cycleId>:<n>` for the next request, n counting from 1. */
  readonly next: () => string;
}
