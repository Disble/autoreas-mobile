import type { SQLiteDatabase } from 'expo-sqlite';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import { buildAppliedOperation, buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { FIRST_ROW_AT } from './unresolved-fixtures.constants';

/** One `operation_log` row as read back from the real database. */
export interface StoredOperationRow {
  readonly id: number;
  readonly status: string;
  readonly unresolved_reason: string | null;
  readonly claim_owner: string | null;
}

/** One `season_rating_queue` row as read back from the real database. */
export interface StoredRatingRow {
  readonly id: number;
  readonly anime_id: string;
  readonly status: string;
  readonly last_failure_kind: string | null;
}

/**
 * Opens a migrated, paired database holding `anime-1` (4 episodes watched) at `token`, and one
 * `pending` outbox row per entry of `episodes`, oldest first.
 */
export async function openPairedDatabase(
  options: { readonly token?: number | null; readonly episodes?: readonly number[] } = {},
): Promise<SQLiteDatabase> {
  const { token = 7, episodes = [5] } = options;
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    0,
  );
  await adapter.runAsync(
    'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'anime-1',
    'Local Name',
    0,
    4,
    1,
    1,
    token,
  );
  for (const [index, watched] of episodes.entries()) {
    await queueEdit(adapter, watched, FIRST_ROW_AT + index);
  }

  return adapter;
}

/** Queues one more local `anime-1` edit, the way the mutation path writes it. */
export async function queueEdit(adapter: SQLiteDatabase, episodesWatched: number, createdAt: number): Promise<void> {
  await adapter.runAsync(
    "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', ?, 'pending', ?)",
    JSON.stringify({ episodesWatched }),
    createdAt,
  );
}

/** A reconcile 202 whose single `applied_operations` entry for `anime-1` carries `entry`. */
export function reconcileAnswer(entry: Record<string, unknown>) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', operation: 'update', ...entry })],
      lastChangelogId: 1,
    }),
  };
}

/** A reconcile 202 confirming `anime-1` at `token`. */
export function confirmedAt(token: number) {
  return reconcileAnswer({ applied: true, modified_at: token });
}

/** The bridge's single-anime answer: a `MobileAnime`, with `modified_at` unless it is omitted. */
export function animeAnswer(fields: { readonly name?: string; readonly episodesWatched?: number; readonly token?: number } = {}) {
  return {
    status: 200,
    body: {
      id: 'anime-1',
      name: fields.name ?? 'Bridge Name',
      status: 0,
      episodesWatched: fields.episodesWatched ?? 9,
      active: 1,
      firstCycle: 1,
      lastWatchedAt: null,
      premieredAt: null,
      createdAt: null,
      deletedAt: null,
      ...(fields.token === undefined ? {} : { modified_at: fields.token }),
    },
  };
}

/** Reads every outbox row back, oldest first. */
export function readOperationRows(adapter: SQLiteDatabase): Promise<StoredOperationRow[]> {
  return adapter.getAllAsync<StoredOperationRow>(
    'SELECT id, status, unresolved_reason, claim_owner FROM operation_log ORDER BY id',
  );
}

/** Reads every season-rating row back, oldest first. */
export function readRatingRows(adapter: SQLiteDatabase): Promise<StoredRatingRow[]> {
  return adapter.getAllAsync<StoredRatingRow>(
    'SELECT id, anime_id, status, last_failure_kind FROM season_rating_queue ORDER BY id',
  );
}

/** Reads `anime-1`'s name, watched count and token, or `null` once the row is gone. */
export function readAnime(adapter: SQLiteDatabase) {
  return adapter.getFirstAsync<{ nombre: string; nrocapvisto: number; bridge_modified_at: number | null }>(
    "SELECT nombre, nrocapvisto, bridge_modified_at FROM animes WHERE _id = 'anime-1'",
  );
}

/** Every outbox operation any recorded reconcile request carried, in send order. */
export function sentOperations(fakeBridge: FakeBridge): { anime_id: string; base?: number }[] {
  return fakeBridge.requests
    .filter((request) => request.url.endsWith('/api/sync/reconcile'))
    .flatMap((request) => (request.body as { pending_operations: { anime_id: string; base?: number }[] }).pending_operations);
}
