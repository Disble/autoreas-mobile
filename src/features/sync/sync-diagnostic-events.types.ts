import type {
  SYNC_DIAGNOSTIC_EVENTS,
  SYNC_DIAGNOSTIC_SOURCES,
} from './sync-diagnostic-events.constants';
import type { SyncCycleErrorCause } from './sync-telemetry.types';

/** Where an event was observed. Closed so no free text reaches an unsanitized store. */
export type SyncDiagnosticSource = (typeof SYNC_DIAGNOSTIC_SOURCES)[number];

/** What was observed. Closed for the same reason. */
export type SyncDiagnosticEventKind = (typeof SYNC_DIAGNOSTIC_EVENTS)[number];

/**
 * One coalesced entry of the diagnostic ring.
 *
 * `firstAt` and `lastAt` are both kept because one timestamp cannot tell an incident from an
 * event: a fault that started ten hours ago and is still repeating reads identically to one that
 * happened a second ago if only the latest instant survives.
 */
export interface SyncDiagnosticEvent {
  readonly source: SyncDiagnosticSource;
  readonly event: SyncDiagnosticEventKind;
  readonly cause: SyncCycleErrorCause | null;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly count: number;
}

/** The exact snake_case shape one ring entry takes on the wire. */
export interface WireSyncDiagnosticEvent {
  readonly source: SyncDiagnosticSource;
  readonly event: SyncDiagnosticEventKind;
  readonly cause: SyncCycleErrorCause | null;
  readonly first_at: number;
  readonly last_at: number;
  readonly count: number;
}
