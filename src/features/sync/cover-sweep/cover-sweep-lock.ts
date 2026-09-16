import type { CoverSweepSummary } from './cover-sweep.types';

/** Module-private single-flight guard: a concurrent `runCoverSweep` call joins this promise instead of starting a second pass. */
let inFlightSweep: Promise<CoverSweepSummary> | null = null;

/** Returns the currently in-flight cover sweep promise, or `null` when no pass is running. */
export function getInFlightCoverSweep(): Promise<CoverSweepSummary> | null {
  return inFlightSweep;
}

/**
 * Registers `sweep` as the in-flight cover sweep and clears the guard once it settles -- but ONLY if
 * `sweep` is still the tracked promise at that point (compare-and-clear). A forced `runCoverSweep`
 * call started while an unforced pass is still running overwrites `inFlightSweep` with its OWN
 * promise before that first pass settles; without this guard, the first pass's `finally` would
 * unconditionally null out the guard while the forced pass is still in flight, so a third caller
 * would fail to join it and start a redundant pass instead.
 */
export function trackInFlightCoverSweep(
  sweep: Promise<CoverSweepSummary>,
): Promise<CoverSweepSummary> {
  const tracked: Promise<CoverSweepSummary> = sweep.finally(() => {
    if (inFlightSweep === tracked) {
      inFlightSweep = null;
    }
  });

  inFlightSweep = tracked;

  return tracked;
}

/**
 * Module-private mutex tail: every exclusive task chains off this promise, in FIFO call order.
 * Always resolved (never rejected) so a settling task -- fulfilled OR rejected -- advances the
 * queue instead of poisoning it.
 */
let coverStoreMutexTail: Promise<void> = Promise.resolve();

/**
 * Serializes every cover-store reader/writer/publisher (manifest read/write, cover-uri-store
 * publish) behind one FIFO queue. Without this, a `hydrateCoverUris` call racing an in-flight
 * `runCoverSweep` pass can read a manifest the sweep is about to overwrite, or publish an URI map
 * after the sweep already deleted the file it points at. Each task starts only once every task
 * queued before it has settled; a rejected task never blocks the ones behind it.
 */
export function runCoverStoreExclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = coverStoreMutexTail.then(task);

  coverStoreMutexTail = result.then(
    () => undefined,
    () => undefined,
  );

  return result;
}
