import type { BridgeClientLogger } from './bridge-client.types';
/** Provides the shared bridge http scheme value. */
export const BRIDGE_HTTP_SCHEME = 'http';
/** Provides the shared bridge ws scheme value. */
export const BRIDGE_WS_SCHEME = 'ws';

/** Provides the shared bridge api paths value. */

export const BRIDGE_API_PATHS = {
  pairDevice: '/api/devices/pair',
  animes: '/api/animes',
  reconcile: '/api/sync/reconcile',
  activeSeason: '/api/seasons/active',
  activeSeasonRating: '/api/seasons/active/ratings',
  syncDiagnostics: '/api/sync/diagnostics',
  ws: '/ws',
} as const;


/** Provides a silent logger when bridge diagnostics are not injected. */
export const NOOP_BRIDGE_LOGGER: BridgeClientLogger = {
  debug: () => undefined,
  warn: () => undefined,
};

/**
 * Default budget for one bridge HTTP request. Roughly 450x the `duration_ms` the bridge records
 * for a reconcile (19-22 ms on the LAN), so it never trips on a slow-but-working link; its job
 * is to convert a request that will never answer into a typed failure the cycle can report.
 */
export const BRIDGE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Upper bound on a `Retry-After`-derived not-before delay. The not-before is PERSISTED, so
 * without a clamp one wrong header or one wrong device clock wedges diagnostics delivery for
 * years, surviving a restart. One hour is far above any plausible bridge backoff and far below
 * the ~25 h horizon at which the outbox's 100-row cap evicts the backlog anyway, so the clamp
 * can never be the thing that loses data.
 */
export const SYNC_DIAGNOSTICS_MAX_RETRY_AFTER_MS = 3_600_000;
