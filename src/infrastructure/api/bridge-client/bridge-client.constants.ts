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
  status: '/api/status',
  activeSeason: '/api/seasons/active',
  activeSeasonRating: '/api/seasons/active/rating',
  ws: '/ws',
} as const;


/** Provides a silent logger when bridge diagnostics are not injected. */
export const NOOP_BRIDGE_LOGGER: BridgeClientLogger = {
  debug: () => undefined,
  warn: () => undefined,
};
