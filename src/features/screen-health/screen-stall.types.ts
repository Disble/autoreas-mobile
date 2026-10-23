import type { SyncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox';
import type {
  SCREEN_STALL_APP_STATES,
  SCREEN_STALL_EVENT_KIND,
  SCREEN_STALL_TRANSITION_EVENTS,
  SCREEN_STALL_TRIGGERS,
} from './screen-stall.constants';

/** What armed a probe. */
export type ScreenStallTrigger = (typeof SCREEN_STALL_TRIGGERS)[number];

/** The app state as the bridge names it. */
export type ScreenStallAppState = (typeof SCREEN_STALL_APP_STATES)[number];

/** One window or app transition a report may list. */
export type ScreenStallTransitionEvent = (typeof SCREEN_STALL_TRANSITION_EVENTS)[number];

/** One transition with the device time it happened. */
export interface ScreenStallTransition {
  readonly event: ScreenStallTransitionEvent;
  readonly atMs: number;
}

/** A size in density-independent pixels. */
export interface ScreenStallSize {
  readonly width: number;
  readonly height: number;
}

/** Everything known when a probe was armed. */
export interface ScreenStallProbeStart {
  readonly trigger: ScreenStallTrigger;
  readonly armedAtMs: number;
  readonly appState: ScreenStallAppState;
  /** `null` until the window has reported a focus or blur. */
  readonly windowFocused: boolean | null;
  readonly windowSize: ScreenStallSize;
  readonly screenSize: ScreenStallSize;
}

/** One stall's wire transition entry. */
export interface ScreenStallWireTransition {
  readonly event: ScreenStallTransitionEvent;
  readonly at_ms: number;
}

/**
 * The exact JSON body of one stall, and every key it may carry. The bridge rejects an undeclared
 * key, so nothing beyond this list may be added without the bridge declaring it first.
 */
export interface ScreenStallWirePayload {
  readonly kind: typeof SCREEN_STALL_EVENT_KIND;
  readonly observation_id: string;
  readonly observed_at_ms: number;
  readonly duration_ms: number;
  readonly trigger: ScreenStallTrigger;
  readonly app_state: ScreenStallAppState;
  readonly window_focused: boolean | null;
  readonly window_width: number;
  readonly window_height: number;
  readonly screen_width: number;
  readonly screen_height: number;
  readonly transitions: readonly ScreenStallWireTransition[];
}

/** Collaborators of the recorder; each defaults to production and exists for tests. */
export interface ScreenStallRecorderParams {
  readonly store?: Pick<SyncDiagnosticsOutboxStore, 'enqueue'>;
  readonly isAccepted?: (payload: ScreenStallWirePayload) => boolean;
}
