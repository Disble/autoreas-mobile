import type {
  BridgeClient,
  BridgeConnection,
} from '../../infrastructure/api/bridge-client/bridge-client.types';
import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';

/** Dependencies `captureSyncDiagnosticsEnvelope` needs; `store` defaults to the shared instance. */
export interface CaptureSyncDiagnosticsEnvelopeParams {
  readonly store?: SyncDiagnosticsOutboxStore;
}

/**
 * Dependencies one bounded flush pass needs. `connection` is mandatory (there is no shared
 * default -- it is per-pairing); `store`, `client` and `now` default to their production
 * collaborators and exist as overrides for the fake-store/fake-client testing strategy.
 */
export interface FlushSyncDiagnosticsOutboxParams {
  readonly connection: BridgeConnection;
  readonly store?: SyncDiagnosticsOutboxStore;
  readonly client?: Pick<BridgeClient, 'postSyncDiagnostics'>;
  readonly now?: () => number;
}

/** Outcome of one bounded flush pass. Always resolves -- never rejects (Decision 5). */
export interface SyncDiagnosticsFlushResult {
  /** Number of entries the bridge was actually asked about this pass. */
  readonly attempted: number;
  /** Number of entries confirmed delivered (2xx) this pass. */
  readonly delivered: number;
}
