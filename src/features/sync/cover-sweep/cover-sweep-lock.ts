import type { CoverSweepSummary } from './cover-sweep.types';

/** Module-private single-flight guard: a concurrent `runCoverSweep` call joins this promise instead of starting a second pass. */
let inFlightSweep: Promise<CoverSweepSummary> | null = null;

/** Returns the currently in-flight cover sweep promise, or `null` when no pass is running. */
export function getInFlightCoverSweep(): Promise<CoverSweepSummary> | null {
  return inFlightSweep;
}

/** Registers `sweep` as the in-flight cover sweep and clears the guard once it settles. */
export function trackInFlightCoverSweep(
  sweep: Promise<CoverSweepSummary>,
): Promise<CoverSweepSummary> {
  inFlightSweep = sweep.finally(() => {
    inFlightSweep = null;
  });

  return inFlightSweep;
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
