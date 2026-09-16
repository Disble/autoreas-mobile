import type { SQLiteDatabase } from 'expo-sqlite';
import { BridgeUnreachableError } from '../../../infrastructure/api/bridge-client/bridge-client.errors';
import type { BridgeAnimeCoverResult, BridgeConnection } from '../../../infrastructure/api';
import { runWithConcurrency } from '../../../infrastructure/async/run-with-concurrency.helpers';
import { buildCoverFileName } from '../../../infrastructure/cover-files/cover-files.helpers';
import type { CoverManifest, CoverManifestEntry } from '../../../infrastructure/cover-files';
import { resolveCoverManifestEntry } from './cover-sweep-entry.helpers';
import {
  getInFlightCoverSweep,
  runCoverStoreExclusive,
  trackInFlightCoverSweep,
} from './cover-sweep-lock';
import { COVER_SWEEP_CONCURRENCY, DEFAULT_COVER_SWEEP_DEPENDENCIES } from './cover-sweep.constants';
import type {
  CoverActiveAnimeSource,
  CoverSweepDependencies,
  CoverSweepOptions,
  CoverSweepOutcome,
  CoverSweepSummary,
} from './cover-sweep.types';

export { computeTransientDelayMs, resolveCoverManifestEntry } from './cover-sweep-entry.helpers';

/**
 * Selects the active anime ids whose cover entry is missing, due (`now >= nextAttemptAt`), or
 * resolved against a DIFFERENT `sourceKey` than the anime's current `portada` -- a changed cover
 * must never wait out a 7-day (or longer) `nextAttemptAt` set for the old one. A legacy entry with
 * no `sourceKey` at all (persisted before this field existed) always counts as a mismatch, so it is
 * re-asked exactly once regardless of what the current source is. Preserves `activeSources`' order
 * so the sweep's request order stays deterministic run to run.
 *
 * `force` (default `false`) bypasses every one of those checks: EVERY active source becomes a
 * target, regardless of `nextAttemptAt` or `sourceKey`. This is what a manual refresh needs -- the
 * bridge answers an unchanged cover with a cheap 304 (round-tripping its stored etag as
 * `ifNoneMatch`), so revalidating everything costs little and catches a cover replaced at the SAME
 * source path, which an unforced sweep would otherwise skip for up to 7 days.
 */
export function selectCoverSweepTargets(
  activeSources: readonly CoverActiveAnimeSource[],
  manifest: CoverManifest,
  now: number,
  force = false,
): readonly string[] {
  const targets: string[] = [];

  for (const { animeId, sourceKey } of activeSources) {
    const entry = manifest.entries[animeId];
    const isDue = force || !entry || now >= entry.nextAttemptAt || entry.sourceKey !== sourceKey;

    if (isDue) {
      targets.push(animeId);
    }
  }

  return targets;
}

/** Drops every manifest entry whose anime id is no longer active, reporting each dropped file for deletion. */
export function pruneInactiveCoverEntries(
  manifest: CoverManifest,
  activeAnimeIds: readonly string[],
): { readonly manifest: CoverManifest; readonly fileNamesToDelete: readonly string[] } {
  const activeIds = new Set(activeAnimeIds);
  const nextEntries: Record<string, CoverManifestEntry> = {};
  const fileNamesToDelete: string[] = [];

  for (const [animeId, entry] of Object.entries(manifest.entries)) {
    if (activeIds.has(animeId)) {
      nextEntries[animeId] = entry;
    } else if (entry.fileName) {
      fileNamesToDelete.push(entry.fileName);
    }
  }

  return {
    manifest: { version: 1, entries: nextEntries },
    fileNamesToDelete,
  };
}

/** Builds the anime-id -> local URI map the cover-uri-store publishes, for every entry with a file. */
export function buildCoverUriMap(
  manifest: CoverManifest,
  toUri: (fileName: string) => string,
): Readonly<Record<string, string>> {
  const map: Record<string, string> = {};

  for (const [animeId, entry] of Object.entries(manifest.entries)) {
    if (entry.fileName) {
      map[animeId] = toUri(entry.fileName);
    }
  }

  return map;
}

/**
 * Decides whether the sweep must stop scheduling further requests: an explicit 401, or a network
 * failure the bridge client already classified as unreachable (a timeout included, since
 * `BridgeTimeoutError extends BridgeUnreachableError`). Neither outcome changes the manifest entry
 * -- the caller is expected to leave the entry untouched when this returns `true`.
 */
export function shouldStopCoverSweep(outcome: CoverSweepOutcome): boolean {
  if (outcome.kind === 'unauthorized') {
    return true;
  }

  return outcome.kind === 'error' && outcome.error instanceof BridgeUnreachableError;
}

/**
 * Restores the cover-uri-store from the persisted manifest. An entry whose file has vanished from
 * disk (deleted out of band) loses its `fileName` and is scheduled for an immediate re-fetch
 * (`nextAttemptAt: 0`); everything else is republished as-is. Never throws: a hydration failure is
 * swallowed and logged, since it must never block app startup.
 *
 * UNLOCKED -- only the exported `hydrateCoverUris` and `executeCoverSweep`'s own step 1 (which
 * already holds the lock) may call this directly; every other caller must go through the lock.
 */
async function hydrateCoverUrisUnlocked(
  deps: CoverSweepDependencies = DEFAULT_COVER_SWEEP_DEPENDENCIES,
): Promise<void> {
  try {
    const manifest = await deps.readManifest();

    // Every entry's existence check is independent, so they run concurrently rather than one
    // await per loop iteration.
    const checkedEntries = await Promise.all(
      Object.entries(manifest.entries).map(async ([animeId, entry]) => {
        if (!entry.fileName) {
          return { animeId, entry, changed: false };
        }

        const exists = await deps.coverFileExists(entry.fileName);

        if (exists) {
          return { animeId, entry, changed: false };
        }

        return {
          animeId,
          entry: { ...entry, fileName: null, nextAttemptAt: 0 },
          changed: true,
        };
      }),
    );

    const nextEntries: Record<string, CoverManifestEntry> = {};
    let changed = false;

    for (const checked of checkedEntries) {
      nextEntries[checked.animeId] = checked.entry;
      changed = changed || checked.changed;
    }

    const nextManifest: CoverManifest = { version: 1, entries: nextEntries };

    if (changed) {
      await deps.writeManifest(nextManifest);
    }

    deps.publishCoverUris(buildCoverUriMap(nextManifest, deps.getCoverFileUri));
  } catch (error) {
    console.warn('[cover-sweep] hydrateCoverUris failed', error);
  }
}

/**
 * Public, LOCKED entry point for {@link hydrateCoverUrisUnlocked}: a hydrate requested while a
 * sweep (or another hydrate) is running queues behind it, then re-reads and republishes the fresh
 * manifest afterwards -- never skipped, so the store always converges on the latest state.
 */
export function hydrateCoverUris(
  deps: CoverSweepDependencies = DEFAULT_COVER_SWEEP_DEPENDENCIES,
): Promise<void> {
  return runCoverStoreExclusive(() => hydrateCoverUrisUnlocked(deps));
}

/** Builds a zero-activity summary, used for every early exit before any cover is fetched. */
function buildEmptySummary(stopped: boolean): CoverSweepSummary {
  return { fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0, stopped };
}

/** Running per-kind counters for one sweep pass, before the final `stopped` flag is known. */
type CoverSweepCounters = { -readonly [K in keyof Omit<CoverSweepSummary, 'stopped'>]: number };

/**
 * Fetches one anime's cover, translating a stop-worthy outcome (401, or an unreachable/timed-out
 * bridge) into the `'stop'` sentinel instead of the raw result or a thrown error.
 */
async function fetchCoverOrStop(
  deps: CoverSweepDependencies,
  connection: BridgeConnection,
  animeId: string,
  previous: CoverManifestEntry | null,
): Promise<BridgeAnimeCoverResult | 'stop'> {
  try {
    const result = await deps.bridgeClient.getAnimeCover(connection, animeId, {
      ifNoneMatch: previous?.fileName ? previous.etag : null,
    });

    return shouldStopCoverSweep(result) ? 'stop' : result;
  } catch (error) {
    if (shouldStopCoverSweep({ kind: 'error', error })) {
      return 'stop';
    }

    throw error;
  }
}

/**
 * Writes the on-disk JPEG for an `image` result and returns the file name the manifest entry
 * should carry; every other kind returns the previous file name unchanged (or `null`).
 *
 * Deletion NEVER happens here, deliberately -- not for a replaced file (etag changed) and not for
 * a newly-absent one (204). A card re-rendering mid-sweep would otherwise briefly point at an
 * already-deleted file, and a crash between this write and `writeManifest` could leave the
 * PREVIOUS manifest (still on disk) referencing a file this function already deleted. The only
 * deletion path is the orphan cleanup in `executeCoverSweep`'s `finally`, which runs strictly
 * AFTER `writeManifest` and deletes every on-disk JPEG no longer referenced by the persisted
 * manifest -- which naturally includes a replaced or newly-absent file, since `entries[animeId]`
 * already points at the new name (or `null`) by the time cleanup runs.
 */
async function applyCoverFileChange(
  deps: CoverSweepDependencies,
  animeId: string,
  previous: CoverManifestEntry | null,
  result: BridgeAnimeCoverResult,
): Promise<string | null> {
  if (result.kind === 'image') {
    const fileName = buildCoverFileName(animeId, result.etag, String(deps.clock.now()));

    await deps.writeCoverImage(fileName, result.bytes);

    return fileName;
  }

  return previous?.fileName ?? null;
}

/** Increments the running per-kind counter in `summary` matching one settled cover result's kind. */
function bumpCoverSweepSummary(summary: CoverSweepCounters, kind: BridgeAnimeCoverResult['kind']): void {
  if (kind === 'image') {
    summary.fetched += 1;
  } else if (kind === 'not_modified') {
    summary.notModified += 1;
  } else if (kind === 'absent') {
    summary.absent += 1;
  } else if (kind === 'unknown') {
    summary.unknown += 1;
  } else if (kind === 'transient') {
    summary.transient += 1;
  }
}

/**
 * Builds the per-anime worker `runWithConcurrency` drives: fetch (or stop), apply the file
 * change, fold the result into `entries`, and bump `summary`. Both `entries` and `summary` are
 * shared, mutated accumulators owned by `executeCoverSweep`. `sourceByAnimeId` supplies the
 * normalized `portada` each request is made for, so `resolveCoverManifestEntry` can stamp the
 * resulting entry with the `sourceKey` it was resolved against.
 */
function buildCoverSweepWorker(
  deps: CoverSweepDependencies,
  connection: BridgeConnection,
  entries: Record<string, CoverManifestEntry>,
  summary: CoverSweepCounters,
  sourceByAnimeId: ReadonlyMap<string, string | null>,
) {
  return async (animeId: string): Promise<'continue' | 'stop'> => {
    const previous = entries[animeId] ?? null;
    const result = await fetchCoverOrStop(deps, connection, animeId, previous);

    if (result === 'stop') {
      return 'stop';
    }

    const fileName = await applyCoverFileChange(deps, animeId, previous, result);
    const sourceKey = sourceByAnimeId.get(animeId) ?? null;

    entries[animeId] = resolveCoverManifestEntry(previous, result, deps.clock.now(), fileName, sourceKey);
    bumpCoverSweepSummary(summary, result.kind);

    return 'continue';
  };
}

/** Runs one full cover-sweep pass (steps 1-7 of the contract). See `runCoverSweep` for the single-flight wrapper around this. */
async function executeCoverSweep(
  rawDb: SQLiteDatabase,
  deps: CoverSweepDependencies,
  options: CoverSweepOptions,
): Promise<CoverSweepSummary> {
  // Step 1: hydrate/publish from whatever is already on disk BEFORE touching the network. UNLOCKED:
  // this function already runs inside `runCoverStoreExclusive` (see `runCoverSweep`), so the locked
  // `hydrateCoverUris` would deadlock against itself here.
  await hydrateCoverUrisUnlocked(deps);

  const config = await deps.getBridgeConfigSnapshot(rawDb);

  if (!config?.ip || !config?.port || !config?.token) {
    return buildEmptySummary(false);
  }

  const manifest = await deps.readManifest();
  const connection: BridgeConnection = { ip: config.ip, port: config.port, token: config.token };
  const activeSources = await deps.readActiveAnimeCoverSources(rawDb);
  const activeAnimeIds = activeSources.map((source) => source.animeId);
  const { manifest: prunedManifest, fileNamesToDelete: prunedFileNames } = pruneInactiveCoverEntries(
    manifest,
    activeAnimeIds,
  );

  const entries: Record<string, CoverManifestEntry> = { ...prunedManifest.entries };
  const summary = { fetched: 0, notModified: 0, absent: 0, unknown: 0, transient: 0 };
  const sourceByAnimeId = new Map(activeSources.map((source) => [source.animeId, source.sourceKey]));

  try {
    const targets = selectCoverSweepTargets(
      activeSources,
      prunedManifest,
      deps.clock.now(),
      options.force ?? false,
    );
    const worker = buildCoverSweepWorker(deps, connection, entries, summary, sourceByAnimeId);

    const { stopped } = await runWithConcurrency(targets, COVER_SWEEP_CONCURRENCY, worker);

    return { ...summary, stopped };
  } finally {
    const finalManifest: CoverManifest = { version: 1, entries };

    await deps.writeManifest(finalManifest);

    const onDiskFileNames = await deps.listCoverFileNames();
    const referencedFileNames = new Set(
      Object.values(entries)
        .map((entry) => entry.fileName)
        .filter((fileName): fileName is string => fileName !== null),
    );
    const orphanFileNames = new Set([
      ...prunedFileNames,
      ...onDiskFileNames.filter((fileName) => !referencedFileNames.has(fileName)),
    ]);

    await Promise.all(
      Array.from(orphanFileNames).map((fileName) => deps.deleteCoverFile(fileName)),
    );

    deps.publishCoverUris(buildCoverUriMap(finalManifest, deps.getCoverFileUri));
  }
}

/**
 * Runs one pass of the offline cover pipeline: hydrates/publishes from the manifest, then (bridge
 * config permitting) fetches every due active-anime cover with bounded concurrency, persists the
 * manifest, deletes orphan JPEGs, and republishes the URI map. Also runs inside
 * `runCoverStoreExclusive`, so a `hydrateCoverUris` call made mid-pass queues behind it instead of
 * racing the manifest.
 *
 * Single-flight for an UNFORCED call: it returns the SAME promise as a previous pass still running.
 * A FORCED call (`{ force: true }`) never joins an in-flight pass -- silently joining one already
 * running unforced would let a manual refresh do nothing, exactly the bug `force` exists to fix.
 * Instead it always queues its OWN pass through `runCoverStoreExclusive`'s FIFO mutex (so it starts
 * only once whatever pass is already in flight settles) and becomes the new tracked in-flight sweep
 * for any later joiner, forced or not (see `trackInFlightCoverSweep`'s compare-and-clear).
 */
export function runCoverSweep(
  rawDb: SQLiteDatabase,
  deps: CoverSweepDependencies = DEFAULT_COVER_SWEEP_DEPENDENCIES,
  options: CoverSweepOptions = {},
): Promise<CoverSweepSummary> {
  const force = options.force ?? false;
  const inFlight = getInFlightCoverSweep();

  if (inFlight && !force) {
    return inFlight;
  }

  return trackInFlightCoverSweep(
    runCoverStoreExclusive(() => executeCoverSweep(rawDb, deps, { force })),
  );
}
