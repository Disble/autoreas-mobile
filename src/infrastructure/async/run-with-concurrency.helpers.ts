import type {
  ConcurrencyWorker,
  RunWithConcurrencyResult,
} from './run-with-concurrency.types';

/** What one lane chain resolves with: `null` when it never threw, or the error it caught. */
type LaneOutcome = { readonly error: unknown } | null;

/**
 * Drives `items` through `worker` with at most `limit` calls in flight at once.
 *
 * Scheduling halts -- no NEW item starts -- the moment a worker reports `'stop'` OR throws;
 * either way, every worker already in flight is awaited before this function settles, so no
 * background work is ever left orphaned. A thrown error is re-thrown only after that drain, and
 * only ONE error is kept (the rest are swallowed): the caller gets one deterministic failure
 * instead of a partial `AggregateError`, matching how a single bounded operation is expected to
 * fail. Each lane catches its own error and RETURNS it (never rejects), so the kept error is
 * chosen deterministically from the settled `Promise.all` results -- the LOWEST-indexed lane that
 * caught one, not whichever lane happened to throw first in wall-clock time (two lanes can throw
 * within the same tick, and which one "wins" a shared-mutable-state race is not something a
 * caller should have to reason about).
 */
export async function runWithConcurrency<TItem>(
  items: readonly TItem[],
  limit: number,
  worker: ConcurrencyWorker<TItem>,
): Promise<RunWithConcurrencyResult> {
  const boundedLimit = Math.min(Math.max(limit, 0), items.length);

  if (boundedLimit === 0) {
    return { stopped: false };
  }

  let nextIndex = 0;
  let stopped = false;

  // Tail-recursive rather than a `for`/`while` loop: each call processes exactly one item, then
  // (via `return runLane()`) hands off to the next. Awaiting sequentially here IS the point --
  // this recursion chain is one bounded worker lane, and awaiting each item before starting the
  // next is what keeps at most `limit` lanes in flight at once. Being a promise-chained tail call
  // rather than a synchronous loop body, it never grows the call stack the way plain recursion
  // would.
  //
  // `stopped` stays a single shared flag (not folded into the return value) because its job is to
  // halt the OTHER lanes' scheduling immediately -- a lane checks it before claiming its next
  // item, so it must be visible across lanes the moment it flips, not only once every lane's
  // promise has settled.
  async function runLane(): Promise<LaneOutcome> {
    if (stopped) {
      return null;
    }

    const index = nextIndex;
    if (index >= items.length) {
      return null;
    }
    nextIndex += 1;

    try {
      const outcome = await worker(items[index]);
      if (outcome === 'stop') {
        stopped = true;
        return null;
      }
    } catch (error) {
      stopped = true;
      return { error };
    }

    return runLane();
  }

  const lanes = Array.from({ length: boundedLimit }, () => runLane());
  const outcomes = await Promise.all(lanes);
  const failure = outcomes.find((outcome): outcome is { readonly error: unknown } => outcome !== null);

  if (failure) {
    throw failure.error;
  }

  return { stopped };
}
