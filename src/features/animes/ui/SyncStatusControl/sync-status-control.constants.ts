import type { SyncStatusIndicatorByKind } from './sync-status-control.types';

/**
 * Maps every sync state kind to its bar glyph. Green when up to date, blue while syncing or queued,
 * amber while waiting for the PC, red when rejected; no sync can run offline or unpaired, so those
 * draw an icon instead of a dot. `idle` (nothing to send, PC not confirmed) stays muted.
 */
export const SYNC_STATUS_INDICATOR_BY_KIND: SyncStatusIndicatorByKind = {
  synced: { glyph: 'dot', color: 'success', isBreathing: false },
  syncing: { glyph: 'dot', color: 'accent', isBreathing: true },
  queued: { glyph: 'dot', color: 'accent', isBreathing: false },
  waiting: { glyph: 'dot', color: 'warning', isBreathing: false },
  stale: { glyph: 'dot', color: 'warning', isBreathing: false },
  rejected: { glyph: 'dot', color: 'danger', isBreathing: false },
  idle: { glyph: 'dot', color: 'muted', isBreathing: false },
  offline: { glyph: 'wifi-off', color: 'muted', isBreathing: false },
  local: { glyph: 'device', color: 'muted', isBreathing: false },
};

/** Ionicons names drawn for the icon glyphs. */
export const SYNC_STATUS_GLYPH_ICON = {
  'wifi-off': 'cloud-offline-outline',
  device: 'phone-portrait-outline',
} as const;

/** Title of the sync status sheet. */
export const SYNC_STATUS_SHEET_TITLE = 'Sincronización';

/** Label of the sheet action that starts a manual sync. */
export const SYNC_STATUS_SYNC_NOW_LABEL = 'Sincronizar ahora';

/** One half of the dot's breath, in milliseconds (the animation alternates). */
export const SYNC_STATUS_BREATH_DURATION_MS = 1200;

/** Opacity the dot breathes down to. */
export const SYNC_STATUS_BREATH_MIN_OPACITY = 0.3;

/** Scale the dot breathes down to. */
export const SYNC_STATUS_BREATH_MIN_SCALE = 0.8;
