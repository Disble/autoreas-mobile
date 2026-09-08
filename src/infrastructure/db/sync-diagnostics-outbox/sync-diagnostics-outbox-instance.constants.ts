import { createSyncDiagnosticsOutboxStore } from './sync-diagnostics-outbox.helpers';
import type { SyncDiagnosticsOutboxStore } from './sync-diagnostics-outbox.types';

/**
 * Shared diagnostics outbox store instance, opened once and reused across sync cycles.
 *
 * Mirrors `bridgeClient`'s own singleton (`bridge-client-instance.constants.ts`): the store's
 * private connection (Decision 7) is meant to be opened ONCE and held open, not reopened per
 * call -- `performSyncPendingOperations` runs at least once per cycle, and every foreground
 * cycle or headless run creating a fresh native SQLite handle without ever closing it would leak
 * connections over the app's lifetime. It lives in its own constants module, mirroring
 * `bridge-client-instance.constants.ts`, so a caller can depend on the store without importing
 * the factory it is built from.
 */
export const syncDiagnosticsOutboxStore: SyncDiagnosticsOutboxStore =
  createSyncDiagnosticsOutboxStore();
