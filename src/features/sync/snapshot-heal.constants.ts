import type { SnapshotHealDemand } from './snapshot-heal.types';

/**
 * How old the last successful snapshot heal must be before a WebSocket reconnect runs the full
 * snapshot again (ADR 009 R-7). It filters the reconnect event; it is never a timer.
 */
export const SNAPSHOT_HEAL_STALE_AFTER_MS = 5 * 60 * 1000;

/** Orders the demands so a run that merges several reasons serves the strongest one. */
export const SNAPSHOT_HEAL_DEMAND_RANK: Readonly<Record<SnapshotHealDemand, number>> = {
  never: 0,
  if_stale: 1,
  always: 2,
};

/**
 * When each database's last snapshot heal succeeded. In memory on purpose: it only has to outlive a
 * resume within one process, and a cold start always heals on mount. A failed heal never writes it.
 */
export const LAST_SUCCESSFUL_SNAPSHOT_HEAL_AT = new WeakMap<object, number>();
