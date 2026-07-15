import { createStore } from 'zustand/vanilla';
import type { SyncConnectionSnapshot } from './sync-connection-store.types';

/** Provides the neutral foreground sync snapshot. */
export const INITIAL_SYNC_CONNECTION_SNAPSHOT: SyncConnectionSnapshot = {
  kind: 'idle',
  lastSyncAt: null,
  message: null,
};

/** Provides the shared vanilla store behind every foreground sync facade consumer. */
export const syncConnectionStore = createStore<SyncConnectionSnapshot>(() =>
  INITIAL_SYNC_CONNECTION_SNAPSHOT,
);

/** Provides shared ownership of one coordinated foreground sync cycle per database. */
export const FOREGROUND_SYNC_CYCLES = new Map<object, Promise<number>>();

/** Provides the current authoritative connection attempt generation. */
export const SYNC_CONNECTION_ATTEMPT_STATE = { current: 0 };

/** Serializes terminal telemetry so newer attempt diagnostics always settle last. */
export const SYNC_CONNECTION_PUBLICATION_QUEUE_STATE = {
  current: Promise.resolve(),
};
