import type { HeadlessSyncCycleStage } from './headless-sync-cycle.types';
import type { SyncCycleStage } from './sync-runtime-status.types';

/**
 * Budget for one whole headless sync cycle, enforced from INSIDE the cycle so the cycle itself
 * settles rather than being abandoned by an outer bound.
 *
 * It sits at 35 s for two reasons, both about neighbouring bounds rather than about a hoped-for
 * duration. It is strictly above the worst legitimate serial pair the cycle can contain -- one
 * `BRIDGE_REQUEST_TIMEOUT_MS` request (10 s) followed by one `LOCAL_WRITE_DEADLINE_MS` write
 * (20 s) -- so a slow-but-progressing cycle is never cut short. And it is 10 s below
 * `BACKGROUND_SYNC_CYCLE_DEADLINE_MS` (45 s), so this bound always fires FIRST and the outer one
 * degrades to a pure backstop. That ordering is the point: the outer deadline can only abandon the
 * cycle, whereas this one settles it, records why, and releases `is_cycle_active`. The 10 s gap is
 * the room `HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS` runs in.
 *
 * A healthy cycle on device completes in about a second (the reconcile POST answers 202 in 4-9 ms),
 * so this is roughly 35x headroom over observed-healthy, not a tight fit.
 */
export const HEADLESS_SYNC_CYCLE_DEADLINE_MS = 35_000;

/**
 * Budget for the bookkeeping that runs after the cycle has been abandoned.
 *
 * The recovery writes go through the same write door whose jamming is the usual reason the cycle
 * was abandoned in the first place, so they can jam too. Bounding them is what keeps
 * `runHeadlessSyncCycle` a function that always resolves instead of one that merely moved the hang
 * somewhere less visible. Chosen to fit inside the 10 s gap between this cycle's budget and
 * `BACKGROUND_SYNC_CYCLE_DEADLINE_MS`, with slack left over, so the outer backstop still never
 * fires first.
 */
export const HEADLESS_SYNC_CYCLE_RECOVERY_DEADLINE_MS = 8_000;

/**
 * Maps this module's own stage checkpoints onto the bridge's closed `SyncCycleStage` vocabulary,
 * reporting `null` rather than a guess wherever there is no EXACT correspondence.
 *
 * The two vocabularies are not the same set: `HeadlessSyncCycleStage` names what
 * `headless-sync-cycle.helpers.ts` can observe on its own, while `SyncCycleStage` additionally
 * distinguishes the checkpoints inside `reconcile.helpers.ts` (`backlog_read`, `claim_ops`,
 * `http`, `parse_response`, `apply_write` -- which includes local SQLite writes through
 * `withLocalWrite`), and that module does not yet publish its own progress. `open`, `config`,
 * `attempt_started`, `cycle_activated`, and `prune` translate directly. `reconcile` and
 * `result_bookkeeping` report `null`: collapsing either one onto a single member such as `http`
 * would misreport a local write-door jam inside reconcile as a transport failure, which is
 * exactly the false-positive class this instrumentation exists to eliminate (design.md,
 * "`last_stage` reports only exact correspondences"). The error triple
 * (`error_name`/`error_stage`/`error_cause`) still carries the discriminating diagnosis for a
 * failure on either of those two checkpoints; only the stage label itself stays honest about
 * what it does not know. Splitting them further requires `reconcile.helpers.ts` to publish its
 * own checkpoints, which is out of this module's scope (see design.md's open follow-up).
 */
export const HEADLESS_STAGE_TO_SYNC_CYCLE_STAGE: Record<
  HeadlessSyncCycleStage,
  SyncCycleStage | null
> = {
  open: 'open',
  bridge_config: 'config',
  attempt_started: 'attempt_started',
  cycle_activated: 'cycle_activated',
  reconcile: null,
  result_bookkeeping: null,
  prune: 'prune',
};
