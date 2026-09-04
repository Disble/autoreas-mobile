import { SYNC_DIAGNOSTIC_EVENT_RING_SIZE } from './sync-diagnostic-events.constants';
import type {
  SyncDiagnosticEvent,
  WireSyncDiagnosticEvent,
} from './sync-diagnostic-events.types';

/** Two entries are the same trouble only when all three dimensions agree. */
function isSameTrouble(left: SyncDiagnosticEvent, right: SyncDiagnosticEvent): boolean {
  return (
    left.source === right.source && left.event === right.event && left.cause === right.cause
  );
}

/**
 * Adds one observation to the bounded diagnostic ring, coalescing repeats.
 *
 * Coalescing is the property that makes a small ring useful. A fault that repeats 48 times --
 * which is exactly what a stuck background cycle does -- would otherwise fill every slot with
 * copies of itself and evict every other signal, burying the context needed to read it. Merged
 * into one entry with a count, the same 48 occurrences cost one slot and say more: they carry
 * how long the fault has been going, not just that it happened.
 *
 * A coalesced entry moves to the END of the ring, so an ONGOING fault is never evicted for being
 * old. Age here has to mean "last seen", not "first seen", or a long-running incident falls out
 * of the window precisely because it has lasted.
 *
 * `cause` participates in the identity on purpose: a write that failed on a closed handle and one
 * that failed on lock contention are different incidents with different fixes, and merging them
 * would erase the distinction the whole error vocabulary exists to preserve.
 *
 * Pure and immutable -- returns a new array, so a caller cannot corrupt a ring it shares.
 */
export function appendDiagnosticEvent(
  ring: readonly SyncDiagnosticEvent[],
  observation: SyncDiagnosticEvent,
): readonly SyncDiagnosticEvent[] {
  const existing = ring.find((entry) => isSameTrouble(entry, observation));

  if (existing) {
    const merged: SyncDiagnosticEvent = {
      ...existing,
      // The FIRST sighting is what dates the incident, so it survives every merge.
      firstAt: Math.min(existing.firstAt, observation.firstAt),
      lastAt: Math.max(existing.lastAt, observation.lastAt),
      count: existing.count + observation.count,
    };

    return [...ring.filter((entry) => entry !== existing), merged];
  }

  const appended = [...ring, observation];

  return appended.length > SYNC_DIAGNOSTIC_EVENT_RING_SIZE
    ? appended.slice(appended.length - SYNC_DIAGNOSTIC_EVENT_RING_SIZE)
    : appended;
}

/**
 * Projects the ring into the exact snake_case contract the bridge receives.
 * Written field by field rather than spread so the wire shape stays a closed set: a field added
 * to the internal model never reaches transport until someone puts it here deliberately.
 */
export function toWireDiagnosticEvents(
  ring: readonly SyncDiagnosticEvent[],
): WireSyncDiagnosticEvent[] {
  return ring.map((entry) => ({
    source: entry.source,
    event: entry.event,
    cause: entry.cause,
    first_at: entry.firstAt,
    last_at: entry.lastAt,
    count: entry.count,
  }));
}
