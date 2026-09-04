import type {
  SyncDiagnosticEventKind,
  SyncDiagnosticSource,
} from '../sync-diagnostic-events.types';
import type { SyncCycleErrorCause } from '../sync-telemetry.types';

/** One observation as a call site reports it, before the store shapes it into a ring entry. */
export interface DiagnosticObservation {
  readonly source: SyncDiagnosticSource;
  readonly event: SyncDiagnosticEventKind;
  readonly cause?: SyncCycleErrorCause | null;
  readonly at: number;
}
