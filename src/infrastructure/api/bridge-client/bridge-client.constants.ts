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
