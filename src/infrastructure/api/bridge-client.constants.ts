export const BRIDGE_HTTP_SCHEME = 'http';
export const BRIDGE_WS_SCHEME = 'ws';

export const BRIDGE_API_PATHS = {
  pairDevice: '/api/devices/pair',
  animes: '/api/animes',
  reconcile: '/api/sync/reconcile',
  status: '/api/status',
  activeSeason: '/api/seasons/active',
  activeSeasonRating: '/api/seasons/active/rating',
  ws: '/ws',
} as const;
