/**
 * Per-file coverage tiers for the sync quality gate.
 *
 * Source of truth: `odd/tasks/sync-core-test-assurance.md` ("Tier classification"). That
 * document is updated whenever this list changes; this file must stay in sync with it.
 *
 * - CORE (100 % lines/branches/functions/statements): critical sync logic -- what is sent to
 *   the bridge, what is written locally, cursor advance, `operation_log` transitions, conflict
 *   resolution, wire parsing/validation, response apply, lease correctness, and recovery of
 *   stuck state.
 * - IMPORTANT (80 % on all four metrics): user-visible sync features and orchestration with
 *   real branching.
 * - INFRA (no entry, no gate): self-validating code -- types, constants with no logic, thin
 *   native seams, barrels, task registration. A file absent from both lists below is INFRA and
 *   gets no `coverageThreshold` key.
 *
 * `src/features/sync/use-reconcile.ts` is deliberately absent from both tiers: the `useReconcile`
 * hook it exports has no consumer anywhere in `src` (dead code), and Jest never produces a
 * coverage-map entry for a file that no test actually `require()`s -- its own (misleadingly
 * named) test file exercises `reconcile.helpers.ts` instead. A per-file `coverageThreshold` entry
 * for a path with no coverage-map entry makes `jest --coverage` fail outright with
 * "Coverage data for <path> was not found", regardless of how well-tested the rest of the suite
 * is. See the feature document's T1 report for the reproduction.
 */

const CORE_FILES = [
  // src/features/sync/** -- critical sync logic.
  'src/features/sync/reconcile.helpers.ts',
  'src/features/sync/reconcile-request.helpers.ts',
  'src/features/sync/reconcile.schema.ts',
  'src/features/sync/reconcile-schema.helpers.ts',
  'src/features/sync/reconcile-conflict.helpers.ts',
  'src/features/sync/reconcile-confirmation.helpers.ts',
  'src/features/sync/reconcile-base-token.helpers.ts',
  'src/features/sync/reconcile.errors.ts',
  'src/features/sync/applied-operation-token.helpers.ts',
  'src/features/sync/operation-log-convergence.helpers.ts',
  'src/features/sync/operation-log-retention.helpers.ts',
  'src/features/sync/pending-remote-changes.helpers.ts',
  'src/features/sync/remote-change-drain.helpers.ts',
  'src/features/sync/last-changelog.helpers.ts',
  'src/features/sync/full-resync.helpers.ts',
  'src/features/sync/initial-sync.helpers.ts',
  'src/features/sync/initial-sync.schema.ts',
  'src/features/sync/season-rating-queue.helpers.ts',
  'src/features/sync/merge/apply-remote-changes.helpers.ts',
  'src/features/sync/merge/field-merge.helpers.ts',
  'src/features/sync/merge/merge-context.helpers.ts',
  'src/features/sync/merge/merge-decision.helpers.ts',
  // CORE outside src/features/sync/** -- write and wire path.
  'src/infrastructure/api/bridge-client/bridge-client.helpers.ts',
  'src/infrastructure/api/bridge-client/bridge-url.helpers.ts',
  'src/infrastructure/api/bridge-client/bridge-client.errors.ts',
  'src/infrastructure/validation/anime-schema/anime.schema.ts',
  'src/infrastructure/validation/anime-schema/anime-wire.helpers.ts',
  'src/features/animes/anime-mutation.helpers.ts',
  'src/infrastructure/db/anime-repository/anime-repository.ts',
  'src/infrastructure/db/anime-repository/anime-repository.helpers.ts',
];

/** IMPORTANT-tier files: user-visible sync features and orchestration with real branching. */
const IMPORTANT_FILES = [
  'src/features/sync/cover-sweep/cover-sweep-entry.helpers.ts',
  'src/features/sync/cover-sweep/cover-sweep.helpers.ts',
  'src/features/sync/cover-sweep/cover-sweep-lock.ts',
  'src/features/sync/foreground-resync-cycle.helpers.ts',
  'src/features/sync/native-battery-optimization.helpers.ts',
  'src/features/sync/native-foreground-service-presence.helpers.ts',
  'src/features/sync/native-foreground-sync-ticker.helpers.ts',
  'src/features/sync/season-sync.helpers.ts',
  'src/features/sync/sync-connection-store/sync-connection-store.helpers.ts',
  'src/features/sync/sync-diagnostic-events.helpers.ts',
  'src/features/sync/sync-diagnostic-store/sync-diagnostic-store.helpers.ts',
  'src/features/sync/sync-diagnostics-flush.helpers.ts',
  'src/features/sync/sync-execution-facade/sync-execution-facade.helpers.ts',
  'src/features/sync/sync-execution-strategy.helpers.ts',
  'src/features/sync/sync-facade.helpers.ts',
  'src/features/sync/sync-runtime-status-patch.helpers.ts',
  'src/features/sync/sync-runtime-status.helpers.ts',
  'src/features/sync/sync-telemetry-preference.helpers.ts',
  'src/features/sync/sync-telemetry.helpers.ts',
  'src/features/sync/sync-visible-status.helpers.ts',
  'src/features/sync/ui/SyncRuntimeGate/sync-runtime-gate.helpers.ts',
  'src/features/sync/ui/SyncRuntimeGate/use-sync-runtime-gate.ts',
  'src/features/sync/use-foreground-resync.ts',
  'src/features/sync/use-incremental-sync-handler.ts',
  'src/features/sync/use-initial-sync.ts',
  'src/features/sync/use-remote-change-drain.ts',
  'src/features/sync/use-season-sync.ts',
  'src/features/sync/use-sync-facade.ts',
  'src/features/sync/use-sync-runtime.ts',
];

/** The maintainer's CORE tier: 100 % on all four coverage metrics. */
const CORE_THRESHOLD = { lines: 100, branches: 100, functions: 100, statements: 100 };
/** The maintainer's IMPORTANT tier: 80 % on all four coverage metrics. */
const IMPORTANT_THRESHOLD = { lines: 80, branches: 80, functions: 80, statements: 80 };

/** Builds the Jest `coverageThreshold` map from the CORE and IMPORTANT tier lists above. */
function buildCoverageThreshold() {
  /** @type {Record<string, typeof CORE_THRESHOLD>} */
  const threshold = {};

  for (const file of CORE_FILES) {
    threshold[file] = CORE_THRESHOLD;
  }

  for (const file of IMPORTANT_FILES) {
    threshold[file] = IMPORTANT_THRESHOLD;
  }

  return threshold;
}

// `buildCoverageThreshold` is consumed by jest.config.js. `CORE_FILES` is also consumed by
// stryker.core.conf.js (T4, odd/tasks/sync-core-test-assurance.md), so the on-demand mutation run
// always targets exactly the CORE tier. `IMPORTANT_FILES` stays module-private.
module.exports = {
  buildCoverageThreshold,
  CORE_FILES,
};
