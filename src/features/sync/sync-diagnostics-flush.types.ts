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
  /**
   * The bridge-config row the caller ALREADY read -- the same row its connection came from. The
   * pass consults it through `isSyncTelemetryEnabled`, the one place the user's switch is
   * interpreted, so a disabled switch shuts the pass down before it reads a single candidate: no
   * POST, no removal, no not-before deferral, and every queued row simply stays pending instead
   * of draining after the switch was turned off. Nullish means enabled, exactly as it does there.
   */
  readonly config?: { isSyncTelemetryEnabled?: unknown } | null;
}

/** Outcome of one bounded flush pass. Always resolves -- never rejects (Decision 5). */
export interface SyncDiagnosticsFlushResult {
  /**
   * Number of entries the bridge was actually asked about this pass. An entry whose `kind` the
   * bridge does not accept is left in place without a request, so it is NOT counted here even
   * though it spends one of the batch slots: no request was issued, and nothing was destroyed
   * either, which is what keeps it out of `discarded`.
   */
  readonly attempted: number;
  /** Number of entries confirmed delivered -- a 2xx response AND a confirmed outbox removal. */
  readonly delivered: number;
  /**
   * Number of entries permanently rejected by the bridge as malformed (400/413/422) and
   * discarded client-side -- a report destroyed, distinct from one still pending redelivery.
   */
  readonly discarded: number;
  /**
   * Number of entries that received a 2xx but whose outbox removal failed. The row remains
   * queued and re-sends next cycle instead of being counted as delivered.
   */
  readonly failedRemovals: number;
}
