export {
  buildCoverUriMap,
  computeTransientDelayMs,
  hydrateCoverUris,
  pruneInactiveCoverEntries,
  resolveCoverManifestEntry,
  runCoverSweep,
  selectCoverSweepTargets,
  shouldStopCoverSweep,
} from './cover-sweep.helpers';
export {
  COVER_REVALIDATE_MS,
  COVER_SWEEP_CONCURRENCY,
  COVER_SWEEP_TRIGGER_SOURCES,
  COVER_TRANSIENT_BASE_DELAY_MS,
  COVER_TRANSIENT_MAX_DELAY_MS,
  COVER_UNKNOWN_RECHECK_MS,
  DEFAULT_COVER_SWEEP_DEPENDENCIES,
} from './cover-sweep.constants';
export type {
  CoverActiveAnimeSource,
  CoverSweepClock,
  CoverSweepDependencies,
  CoverSweepOutcome,
  CoverSweepSummary,
} from './cover-sweep.types';
