import fs from 'node:fs';
import path from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';
import { CONTRACT_FIXTURE_GROUPS, CONTRACT_FIXTURES_DIR } from './contract-fixture.constants';
import type {
  ContractBridgeStep,
  ContractExpectation,
  ContractFixture,
  ContractGiven,
  ContractRequest,
} from './contract-fixture.types';
import type { FakeBridge, FakeBridgeRequest } from './fake-bridge.types';
import { applyMigrationFiles, createTestSqliteAdapter } from './sqlite-adapter.helpers';

/** Every shared contract fixture, grouped by queue, each group in file-name order. */
export function loadContractFixtures(): ContractFixture[] {
  return CONTRACT_FIXTURE_GROUPS.flatMap((group) => {
    const directory = path.join(CONTRACT_FIXTURES_DIR, group);

    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')) as ContractFixture);
  });
}

/** Whether a scripted step refuses the connection instead of answering. */
function isTransportStep(step: ContractBridgeStep): step is { readonly transport: 'refused' } {
  return 'transport' in step;
}

/** Queues one cycle's scripted answers on the fake bridge, in order. */
export function queueContractCycle(fakeBridge: FakeBridge, steps: readonly ContractBridgeStep[]): void {
  for (const step of steps) {
    if (isTransportStep(step)) {
      fakeBridge.queueTransportFailure();
    } else {
      fakeBridge.queueResponse({ status: step.status, body: step.body });
    }
  }
}

/** Projects one reconcile operation to the fields both runtimes send: never `created_at`. */
function projectOperation(operation: Record<string, unknown>): Record<string, unknown> {
  return {
    anime_id: operation.anime_id,
    operation: operation.operation,
    payload: operation.payload,
    ...('base' in operation ? { base: operation.base } : {}),
  };
}

/** Projects one recorded request to the shared {@link ContractRequest} shape. */
function projectRequest(request: FakeBridgeRequest): ContractRequest {
  const requestPath = new URL(request.url).pathname;
  const body = request.body as Record<string, unknown> | undefined;

  if (requestPath === '/api/sync/reconcile') {
    return {
      method: request.method,
      path: requestPath,
      lastChangelogId: body?.last_changelog_id as number,
      operations: ((body?.pending_operations ?? []) as Record<string, unknown>[]).map(projectOperation),
    };
  }

  return request.method === 'GET' ? { method: request.method, path: requestPath } : { method: request.method, path: requestPath, body };
}

/**
 * The requests the bridge answered, projected. The nth recorded request met the nth scripted
 * step; one met by a refused connection never reached a bridge (the Kotlin runner's refused port
 * records none), so it is left out. A request beyond the script is kept: it is a call the
 * fixture did not intend.
 */
export function answeredContractRequests(
  requests: readonly FakeBridgeRequest[],
  steps: readonly ContractBridgeStep[],
): ContractRequest[] {
  return requests
    .filter((_request, index) => !(steps[index] && isTransportStep(steps[index])))
    .map(projectRequest);
}

/** Opens a migrated, paired database holding the fixture's precondition. */
export async function openContractDatabase(given: ContractGiven, now: number): Promise<SQLiteDatabase> {
  const adapter: SQLiteDatabase = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await adapter.runAsync(
    'INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, ?, ?, ?, ?, ?)',
    '192.168.0.10',
    8080,
    'token-1',
    'device-1',
    given.cursor,
  );

  for (const anime of given.animes) {
    await adapter.runAsync(
      'INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez, bridge_modified_at) VALUES (?, ?, 0, 4, 1, 1, ?)',
      anime.id,
      `Local ${anime.id}`,
      anime.token,
    );
  }

  for (const [index, row] of given.outbox.entries()) {
    await adapter.runAsync(
      "INSERT INTO operation_log (anime_id, operation, payload, status, created_at, conflict_attempt_count) VALUES (?, ?, ?, 'pending', ?, ?)",
      row.animeId,
      row.operation ?? 'update',
      JSON.stringify(row.payload),
      now + index,
      row.conflictAttemptCount ?? 0,
    );
  }

  for (const rating of given.ratings ?? []) {
    await adapter.runAsync(
      "INSERT INTO season_rating_queue (season_id, anime_id, nota, rated_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      rating.seasonId,
      rating.animeId,
      rating.nota,
      rating.ratedAt,
      now,
      now,
    );
  }

  return adapter;
}

/** Reads back exactly the state keys `expectation` names, in the fixture's shape. */
export async function readContractState(
  adapter: SQLiteDatabase,
  given: ContractGiven,
  expectation: ContractExpectation,
): Promise<Omit<ContractExpectation, 'requests'>> {
  const state: Record<string, unknown> = {};

  if (expectation.outbox) {
    const rows = await adapter.getAllAsync<Record<string, unknown>>(
      'SELECT anime_id, status, unresolved_reason, claim_owner, conflict_attempt_count FROM operation_log ORDER BY id',
    );
    state.outbox = rows.map((row) => ({
      animeId: row.anime_id,
      status: row.status,
      unresolvedReason: row.unresolved_reason,
      claimOwner: row.claim_owner,
      conflictAttemptCount: row.conflict_attempt_count,
    }));
  }

  if (expectation.cursor !== undefined) {
    const config = await adapter.getFirstAsync<{ last_changelog_id: number }>(
      'SELECT last_changelog_id FROM bridge_config WHERE id = 1',
    );
    state.cursor = config?.last_changelog_id;
  }

  if (expectation.tokens) {
    const tokens: Record<string, number | null> = {};
    for (const anime of given.animes) {
      const row = await adapter.getFirstAsync<{ bridge_modified_at: number | null }>(
        'SELECT bridge_modified_at FROM animes WHERE _id = ?',
        anime.id,
      );
      tokens[anime.id] = row?.bridge_modified_at ?? null;
    }
    state.tokens = tokens;
  }

  if (expectation.staged) {
    const staged = await adapter.getAllAsync<{ record_id: string }>('SELECT record_id FROM pending_remote_changes ORDER BY id');
    state.staged = staged.map((row) => row.record_id);
  }

  if (expectation.ratings) {
    const ratings = await adapter.getAllAsync<Record<string, unknown>>(
      'SELECT anime_id, status, last_failure_kind FROM season_rating_queue ORDER BY id',
    );
    state.ratings = ratings.map((row) => ({ animeId: row.anime_id, status: row.status, lastFailureKind: row.last_failure_kind }));
  }

  return state;
}
