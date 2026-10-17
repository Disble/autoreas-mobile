import type { SYNC_CYCLE_ERROR_CAUSES } from './sync-telemetry.constants';

/** Canonical reason a failure happened, derived on-client from the message so the message stays home. */
export type SyncCycleErrorCause = (typeof SYNC_CYCLE_ERROR_CAUSES)[number];
