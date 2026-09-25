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
  /**
   * Body `kind`s this build declares the bridge will never accept -- the ONLY authority that lets
   * this pass destroy a stored row without asking the bridge. Defaults to
   * `SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS`, which is empty today and must be empty until a kind is
   * deliberately placed there: absence from the accepted registry is not a destruction trigger.
   * Injectable for the same reason `store`, `client` and `now` are -- the destruction branch has to
   * be pinnable by a test while the shipped declaration stays empty.
   */
  readonly undeliverableKinds?: readonly string[];
}

/**
 * One stored body's routing class, decided by the ONE field the bridge itself classifies on: the
 * body's top-level `kind`. Produced by the classifier in `sync-diagnostics-flush.helpers.ts` and
 * consumed by the pure disposition ladder in `sync-diagnostics-disposition.helpers.ts`.
 */
export type SyncDiagnosticsPayloadClass = 'routable' | 'undeliverable' | 'unclassified';

/**
 * What one candidate's round trip resolved to, flattened so the flush loop is a tally, not a
 * ladder. Every value names one outbox outcome the pass has to count separately, except
 * `'failed_removal'`, which the thin executor produces when a 2xx was answered but the removal it
 * authorizes was not confirmed.
 */
export type SyncDiagnosticsEnvelopeDisposition =
  | 'delivered'
  | 'failed_removal'
  | 'discarded'
  | 'undeliverable'
  | 'unclassified'
  | 'stop';

/**
 * The four fields of one diagnostics POST verdict the disposition ladder reads -- nothing else.
 *
 * Deliberately narrower than the transport's own result type: the ladder must not be able to grow
 * a branch on `data`, `rawBody` or `url`, all of which describe the wire rather than the verdict.
 * `retryAfterMs` is `null` when the response declared no usable `Retry-After` at all, which is a
 * different state from a declared wait of `0`.
 *
 * `refusalCode` is the refusal's own declared meaning, DISTILLED from the response body at the
 * transport boundary by `readSyncDiagnosticsRefusalCode` -- so the ladder branches on what the
 * bridge said the refusal was, never on the bytes that carried it. `null` means the body declared
 * no readable code at all (absent, not a string, not JSON, not an object, or a non-string `code`),
 * which is a STATE OF ITS OWN: it is answered by the status, and it is never read as "unclassified"
 * or as a recoverable refusal. On a `400` that absence is load-bearing in the other direction too:
 * it means the bridge does not declare a refusal VOCABULARY, so its answer is about its own version
 * rather than about these bytes, and the row is kept.
 */
export interface SyncDiagnosticsPostVerdict {
  readonly ok: boolean;
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly refusalCode: string | null;
}

/**
 * The MUTABLE running tallies one flush pass folds every candidate's disposition into.
 *
 * Derived from the public result rather than restated, so a counter can never exist in one shape
 * and be missing from the other: the result IS this object with its members made `readonly`. The
 * pass copies it once on the way out, so no caller can observe a tally that is still accumulating.
 */
export type SyncDiagnosticsFlushTally = {
  -readonly [Counter in keyof SyncDiagnosticsFlushResult]: SyncDiagnosticsFlushResult[Counter];
};

/** Outcome of one bounded flush pass. Always resolves -- never rejects (Decision 5). */
export interface SyncDiagnosticsFlushResult {
  /**
   * Number of entries the bridge was actually asked about this pass. An entry whose `kind` the
   * bridge does not accept is left in place without a request, so it is NOT counted here even
   * though it spends one of the batch slots: no request was issued, and nothing was destroyed
   * either, which is what keeps it out of `discarded`. An entry the bridge refused with a `400` that
   * declared no code IS counted here -- it was asked about -- and that park leaves no counter of its
   * own, so such a pass reads as `attempted > 0` with nothing else moved.
   */
  readonly attempted: number;
  /** Number of entries confirmed delivered -- a 2xx response AND a confirmed outbox removal. */
  readonly delivered: number;
  /**
   * Number of entries the bridge's own verdict permanently rejected and that were discarded
   * client-side -- a report destroyed by the BRIDGE's judgement, which is the only kind of
   * destruction its contract authorizes. That verdict is a `413` with or without a code, or a `400`
   * that DECLARED a code: size is permanent for the bytes themselves, and a declared code names a
   * judgement about them. A `400` that declared no code is NOT one of these -- it is a version
   * state, so the row is kept and this counter does not move.
   */
  readonly discarded: number;
  /**
   * Number of entries DESTROYED BY DECLARATION: their `kind` is in
   * `SYNC_DIAGNOSTICS_UNDELIVERABLE_KINDS`, so this build knows the bridge refuses them forever and
   * parking could never be resolved by anything this app can do. Deliberately NOT folded into
   * `discarded`: that counter answers "the bridge condemned these bytes", this one answers "we did",
   * and only this one is a decision the registry can get wrong.
   */
  readonly undeliverable: number;
  /**
   * Number of entries PARKED because this build does not know their `kind`: never posted, never
   * deleted, never counted as `attempted`. A GAP counter, not a loss counter -- they belong to a
   * different build of this app and rolling forward is what recovers them, so destroying them would
   * convert a recoverable registry mistake into an irreversible one.
   */
  readonly unclassified: number;
  /**
   * Number of entries that received a 2xx but whose outbox removal failed. The row remains
   * queued and re-sends next cycle instead of being counted as delivered.
   */
  readonly failedRemovals: number;
}
