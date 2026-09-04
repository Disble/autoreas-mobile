import {
  SYNC_DIAGNOSTIC_EVENTS,
  SYNC_DIAGNOSTIC_SOURCES,
} from '../sync-diagnostic-events.constants';
import { appendDiagnosticEvent } from '../sync-diagnostic-events.helpers';
import type { SyncDiagnosticEvent } from '../sync-diagnostic-events.types';
import { SYNC_DIAGNOSTIC_RING_STATE } from './sync-diagnostic-store.constants';
import type { DiagnosticObservation } from './sync-diagnostic-store.types';

/** Clears the ring. Exists for tests and for a deliberate restart, not for routine use. */
export function resetDiagnosticEvents(): void {
  SYNC_DIAGNOSTIC_RING_STATE.current = [];
}

/** Returns the current ring without consuming it. */
export function readDiagnosticEvents(): readonly SyncDiagnosticEvent[] {
  return SYNC_DIAGNOSTIC_RING_STATE.current;
}

/**
 * Records one observation, coalescing it into any matching entry.
 *
 * Never throws and never rejects a caller: this is instrumentation, and a diagnostic feed that
 * can break the code it observes is worse than no feed at all. An observation outside the closed
 * vocabulary is DROPPED rather than forwarded, because that vocabulary is a transport-privacy
 * boundary -- the bridge stores request bodies verbatim, so an unrecognized symbol must never
 * ride along on the chance that it happens to be harmless.
 */
export function recordDiagnosticEvent(observation: DiagnosticObservation): void {
  try {
    const isKnownSource = (SYNC_DIAGNOSTIC_SOURCES as readonly string[]).includes(
      observation.source,
    );
    const isKnownEvent = (SYNC_DIAGNOSTIC_EVENTS as readonly string[]).includes(
      observation.event,
    );

    if (!isKnownSource || !isKnownEvent || !Number.isFinite(observation.at)) {
      return;
    }

    SYNC_DIAGNOSTIC_RING_STATE.current = appendDiagnosticEvent(
      SYNC_DIAGNOSTIC_RING_STATE.current,
      {
        source: observation.source,
        event: observation.event,
        cause: observation.cause ?? null,
        firstAt: observation.at,
        lastAt: observation.at,
        count: 1,
      },
    );
  } catch {
    // Swallowed on purpose; see the contract above.
  }
}

/**
 * Returns the ring and empties it, so each batch of trouble is reported once.
 *
 * Draining matters: without it a fault from hours ago would keep riding along on every reconcile
 * for the rest of the process, turning the feed into permanent noise and making "still happening"
 * indistinguishable from "happened once, long ago".
 */
export function drainDiagnosticEvents(): readonly SyncDiagnosticEvent[] {
  const drained = SYNC_DIAGNOSTIC_RING_STATE.current;
  SYNC_DIAGNOSTIC_RING_STATE.current = [];

  return drained;
}
