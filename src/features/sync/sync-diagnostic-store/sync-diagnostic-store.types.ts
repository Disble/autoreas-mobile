import type {
  SyncDiagnosticCause,
  SyncDiagnosticEventKind,
  SyncDiagnosticSource,
} from '../sync-diagnostic-events.types';

/** One observation as a call site reports it, before the store shapes it into a ring entry. */
export interface DiagnosticObservation {
  readonly source: SyncDiagnosticSource;
  readonly event: SyncDiagnosticEventKind;
  readonly cause?: SyncDiagnosticCause | null;
  readonly at: number;
}
