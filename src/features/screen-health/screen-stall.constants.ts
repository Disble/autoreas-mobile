/**
 * The bridge's name for a screen-stall body at `POST /api/sync/diagnostics`.
 *
 * Posted only once it is listed in `SYNC_DIAGNOSTICS_ACCEPTED_KINDS`: the bridge strict-decodes the
 * body and the flush deletes a row the bridge refuses, so the recorder stays silent until then.
 */
export const SCREEN_STALL_EVENT_KIND = 'screen_stall';

/**
 * The shortest probe that counts as a stall. A healthy screen paints a re-mounted view within a
 * frame or two; two seconds is far beyond any normal transition and well inside "every button is
 * dead", which lasted minutes in the field report that motivated this channel.
 */
export const SCREEN_STALL_THRESHOLD_MS = 2000;

/** The longest duration the bridge accepts; a probe that settles later is dropped, not clamped. */
export const SCREEN_STALL_MAX_DURATION_MS = 3_600_000;

/** How many window/app transitions one report carries, newest kept. */
export const SCREEN_STALL_MAX_TRANSITIONS = 8;

/** What armed the probe. */
export const SCREEN_STALL_TRIGGERS = ['touch', 'app_active', 'focus', 'resize'] as const;

/** The app states the bridge accepts; anything else is reported as `unknown`. */
export const SCREEN_STALL_APP_STATES = ['active', 'background', 'inactive', 'unknown'] as const;

/** Window and app transitions a report may list. */
export const SCREEN_STALL_TRANSITION_EVENTS = [
  'active',
  'background',
  'inactive',
  'focus',
  'blur',
  'resize',
] as const;
