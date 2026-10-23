import type { AppStateStatus } from 'react-native';
import { syncDiagnosticsOutboxStore } from '../../infrastructure/db/sync-diagnostics-outbox/sync-diagnostics-outbox-instance.constants';
import { isSyncDiagnosticsPayloadAccepted } from '../sync/sync-diagnostics-flush.helpers';
import {
  SCREEN_STALL_APP_STATES,
  SCREEN_STALL_EVENT_KIND,
  SCREEN_STALL_MAX_DURATION_MS,
  SCREEN_STALL_MAX_TRANSITIONS,
  SCREEN_STALL_THRESHOLD_MS,
} from './screen-stall.constants';
import type {
  ScreenStallAppState,
  ScreenStallProbeStart,
  ScreenStallRecorderParams,
  ScreenStallSize,
  ScreenStallTransition,
  ScreenStallWirePayload,
} from './screen-stall.types';

/** Maps React Native's app state onto the bridge vocabulary; anything unrecognized is `unknown`. */
export function toScreenStallAppState(state: AppStateStatus | null | undefined): ScreenStallAppState {
  return (SCREEN_STALL_APP_STATES as readonly string[]).includes(state ?? '')
    ? (state as ScreenStallAppState)
    : 'unknown';
}

/** Appends one transition and keeps only the newest ones a report may carry, oldest first. */
export function appendScreenStallTransition(
  transitions: readonly ScreenStallTransition[],
  transition: ScreenStallTransition,
): readonly ScreenStallTransition[] {
  return [...transitions, transition].slice(-SCREEN_STALL_MAX_TRANSITIONS);
}

/** True for a size the bridge accepts: whole, positive dimensions. */
function isReportableSize(size: ScreenStallSize): boolean {
  return [size.width, size.height].every((value) => Number.isFinite(value) && value > 0);
}

/**
 * Builds the wire body for one settled probe, or `null` when the probe was not a stall.
 *
 * A probe under the threshold is a healthy screen and reports nothing. One beyond the bridge's
 * maximum is dropped rather than clamped, because a clamped duration would read as a real
 * measurement. Sizes are rounded to whole dp, the unit the bridge stores.
 */
export function buildScreenStallWirePayload(
  start: ScreenStallProbeStart,
  settledAtMs: number,
  transitions: readonly ScreenStallTransition[],
  observationId: string,
): ScreenStallWirePayload | null {
  const durationMs = Math.round(settledAtMs - start.armedAtMs);
  if (durationMs < SCREEN_STALL_THRESHOLD_MS || durationMs > SCREEN_STALL_MAX_DURATION_MS) {
    return null;
  }

  if (!isReportableSize(start.windowSize) || !isReportableSize(start.screenSize)) {
    return null;
  }

  return {
    kind: SCREEN_STALL_EVENT_KIND,
    observation_id: observationId,
    observed_at_ms: start.armedAtMs,
    duration_ms: durationMs,
    trigger: start.trigger,
    app_state: start.appState,
    window_focused: start.windowFocused,
    window_width: Math.round(start.windowSize.width),
    window_height: Math.round(start.windowSize.height),
    screen_width: Math.round(start.screenSize.width),
    screen_height: Math.round(start.screenSize.height),
    transitions: transitions
      .slice(-SCREEN_STALL_MAX_TRANSITIONS)
      .map((transition) => ({ event: transition.event, at_ms: transition.atMs })),
  };
}

/**
 * Stores one stall in the diagnostics outbox, the same door chapter telemetry uses, so the
 * existing flush delivers it. Silent while the bridge does not accept the kind: the flush deletes
 * a refused row, so writing one would only destroy it. Never throws, because a telemetry failure
 * must not reach the screen it is reporting on.
 */
export function recordScreenStall(
  payload: ScreenStallWirePayload,
  params: ScreenStallRecorderParams = {},
): void {
  const isAccepted = params.isAccepted ?? isSyncDiagnosticsPayloadAccepted;

  try {
    if (!isAccepted(payload)) {
      return;
    }

    (params.store ?? syncDiagnosticsOutboxStore).enqueue({
      cycleId: payload.observation_id,
      payload: JSON.stringify(payload),
    });
  } catch {
    // Swallowed by contract: see the function doc.
  }
}
