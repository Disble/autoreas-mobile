import type { SQLiteDatabase } from 'expo-sqlite';
import type { FakeBridge } from '../../support/fake-bridge.types';
import { buildAppliedOperation, buildReconcileResponseBody } from '../../support/sync-fixtures.helpers';
import { applyMigrationFiles, createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';
import { RATING, RATING_FIRST_ROW_AT } from './season-rating-fixtures.constants';
import type { SeededRow, StoredRow } from './season-rating-fixtures.types';

/** Opens a migrated, paired database holding `anime-1` (and `anime-2`) at `token`. */
export async function openDatabase(token: number | null = 7): Promise<SQLiteDatabase> {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, 0)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
  );
  for (const animeId of ['anime-1', 'anime-2']) {
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, 0, 4, 1, 1, ?)',
      animeId,
      `Local ${animeId}`,
      token,
    );
  }

  return adapter;
}

/** Queues one row; `id` doubles as its `created_at` offset, so ids follow queue order. */
export async function seed(
  adapter: SQLiteDatabase,
  row: SeededRow,
): Promise<void> {
  const payload = row.payload ?? (row.operation === 'update' ? { episodesWatched: 5 } : RATING);
  await adapter.runAsync(
    'INSERT INTO operation_log (id, anime_id, operation, payload, status, created_at, unresolved_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id,
    row.animeId ?? 'anime-1',
    row.operation,
    JSON.stringify(payload),
    row.status ?? 'pending',
    RATING_FIRST_ROW_AT + row.id,
    row.reason ?? null,
  );
}

/** Reads every row back, oldest first. */
export function readRows(adapter: SQLiteDatabase): Promise<StoredRow[]> {
  return adapter.getAllAsync<StoredRow>('SELECT id, operation, status, unresolved_reason, claim_owner FROM operation_log ORDER BY id');
}

/** A reconcile answer confirming `anime-1` at `token`. */
export function confirmed(token: number) {
  return {
    status: 202,
    body: buildReconcileResponseBody({
      appliedOperations: [buildAppliedOperation({ anime_id: 'anime-1', applied: true, modified_at: token })],
      lastChangelogId: 1,
    }),
  };
}

/** A reconcile answer with nothing applied and nothing pulled. */
export function pullOnly(bridgeChanges: unknown[] = []) {
  return { status: 202, body: buildReconcileResponseBody({ bridgeChanges: bridgeChanges as never, lastChangelogId: 1 }) };
}

/** The path of every request the bridge received, in order. */
export function paths(fakeBridge: FakeBridge): string[] {
  return fakeBridge.requests.map((request) => new URL(request.url).pathname);
}


/** Waits until the bridge has received `count` requests, or gives up after about 250 ms. */
export async function waitForRequests(fakeBridge: FakeBridge, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && fakeBridge.requests.length < count; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
