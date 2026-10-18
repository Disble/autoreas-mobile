import type { SQLiteDatabase } from 'expo-sqlite';
import journal from '../../../src/infrastructure/db/migrations/meta/_journal.json';
import { dropDeadSyncRuntimeStatusColumns } from '../../../src/infrastructure/db/client/sync-runtime-status-column-drop.helpers';
import { DEAD_SYNC_RUNTIME_STATUS_COLUMNS } from '../../../src/infrastructure/db/client/sync-runtime-status-column-drop.constants';
import { prepareForegroundDatabase } from '../../../src/infrastructure/db/startup/startup.helpers';
import { GATE_MIGRATOR_LOG, READINESS_20_VERSION } from '../../support/migration-gate.constants';
import {
  createCrashingAdapter,
  dumpDatabase,
  openReadiness20Device,
  readUserVersion,
} from '../../support/migration-gate.helpers';
import type { DatabaseDump } from '../../support/migration-gate.types';
import { createTestSqliteAdapter } from '../../support/sqlite-adapter.helpers';

// The migrator is drizzle's REAL single-scalar gate: the upgrade proves that the gate applies
// nothing on an installed device and the repair step alone drops the columns, while a fresh install
// reaches the same table through migration 0020.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createUnwrappingDrizzleFactory(),
  getDrizzleMigrator: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/migration-gate.helpers').createGateMigrator(),
  getOpenDatabaseSync: () => () => undefined,
}));

/** The columns `sync_runtime_status` keeps after 0020, sorted (S14, coordinator decision 2). */
const KEPT_COLUMNS: readonly string[] = [
  'can_show_persistent_notification',
  'execution_mode',
  'id',
  'last_attempt_at',
  'last_cycle_id',
  'last_cycle_stage',
  'last_error_name',
  'last_success_at',
  'registration_status',
];

/** The kept columns, in a fixed order, for reading the singleton row before and after. */
const KEPT_SELECT = `SELECT ${KEPT_COLUMNS.join(', ')} FROM sync_runtime_status ORDER BY id`;

/**
 * The tables the upgrade is allowed to change; every other table must stay byte-identical. The
 * repair twins of migration 0021 add one column each to `animes` and `bridge_config`.
 */
const CHANGED_TABLES: readonly string[] = ['sync_runtime_status', 'animes', 'bridge_config', '__drizzle_migrations'];

/** The newest `when` the shipped journal holds: the scalar the upgrade pins the ledger to. */
const JOURNAL_MAX_WHEN = Math.max(...journal.entries.map((entry) => entry.when));

/** Builds a device stamped 20 with bridge config, animes, operations and a runtime row in every column. */
async function openSeededDevice(): Promise<SQLiteDatabase> {
  const adapter = await openReadiness20Device();
  await adapter.runAsync(
    "INSERT INTO bridge_config (id, ip, port, token, device_id, last_changelog_id) VALUES (1, '192.168.0.10', 8080, 'tok', 'dev-1', 5)",
  );
  await adapter.runAsync(
    "INSERT INTO animes (_id, nombre, estado, nrocapvisto, activo, primeravez) VALUES ('anime-1', 'Uno', 0, 4, 1, 1), ('anime-2', 'Dos', 1, 9, 1, 0)",
  );
  await adapter.runAsync(
    "INSERT INTO operation_log (anime_id, operation, payload, status, created_at) VALUES ('anime-1', 'update', '{\"episodesWatched\":5}', 'pending', 50), ('anime-2', 'update', '{\"estado\":1}', 'dead_letter', 60)",
  );
  // Every dead column carries a non-default value, so a drop that kept one would show.
  const deadValues = DEAD_SYNC_RUNTIME_STATUS_COLUMNS.map(() => '7');
  await adapter.runAsync(
    `INSERT INTO sync_runtime_status (id, registration_status, execution_mode, can_show_persistent_notification, last_attempt_at, last_success_at, last_cycle_id, last_cycle_stage, last_error_name, ${DEAD_SYNC_RUNTIME_STATUS_COLUMNS.join(', ')}) ` +
      `VALUES (1, 'registered', 'android_foreground_service', 1, 2000, 1500, 'native-cycle-9', 'reconcile_sent', 'ReconcileHttpError', ${deadValues.join(', ')})`,
  );

  return adapter;
}

/** Reads the names of the columns `sync_runtime_status` holds, sorted. */
async function readColumns(adapter: SQLiteDatabase): Promise<string[]> {
  const columns = await adapter.getAllAsync<{ name: string }>('PRAGMA table_info(sync_runtime_status)');

  return columns.map((column) => column.name).sort();
}

/** Reads every ledger `created_at`, the scalars the gate decides from. */
async function readLedger(adapter: SQLiteDatabase): Promise<number[]> {
  const rows = await adapter.getAllAsync<{ created_at: number }>('SELECT created_at FROM __drizzle_migrations ORDER BY rowid');

  return rows.map((row) => Number(row.created_at));
}

/** The schema entries and rows of every table outside `CHANGED_TABLES`. */
function untouched(dump: DatabaseDump) {
  return {
    schema: dump.schema.filter((entry) => !CHANGED_TABLES.includes(entry.tbl_name)),
    tables: Object.fromEntries(Object.entries(dump.tables).filter(([name]) => !CHANGED_TABLES.includes(name))),
  };
}

/**
 * The database a startup leaves when it dies right before the drop's transaction begins: the
 * idempotent repairs that run earlier (columns, ledger pin) have committed, the drop has touched
 * nothing. A crash inside the drop must leave exactly this, byte for byte.
 */
async function dumpStartupStoppedBeforeTheDrop(): Promise<DatabaseDump> {
  const adapter = await openSeededDevice();
  const crashing = createCrashingAdapter(adapter, (source) => /^\s*BEGIN EXCLUSIVE/.test(source));
  await expect(prepareForegroundDatabase(crashing)).rejects.toThrow('injected failure');

  return dumpDatabase(adapter);
}

describe('sync_runtime_status dead-column drop through the real drizzle gate (migration 0020)', () => {
  beforeEach(() => {
    GATE_MIGRATOR_LOG.length = 0;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a device stamped 20: every dead column present, ledger pinned to 0019, readiness 20', async () => {
    const adapter = await openSeededDevice();

    expect(DEAD_SYNC_RUNTIME_STATUS_COLUMNS).toHaveLength(27);
    expect(await readUserVersion(adapter)).toBe(READINESS_20_VERSION);
    expect(await readColumns(adapter)).toEqual([...KEPT_COLUMNS, ...DEAD_SYNC_RUNTIME_STATUS_COLUMNS].sort());
    expect(await readLedger(adapter)).toEqual(Array.from({ length: 20 }, () => 1792195200000));
  });

  it('drops every dead column while the real gate applies nothing, keeps the row, and stamps 22', async () => {
    const adapter = await openSeededDevice();
    const keptRow = await adapter.getAllAsync(KEPT_SELECT);
    const before = await dumpDatabase(adapter);
    GATE_MIGRATOR_LOG.length = 0;

    await prepareForegroundDatabase(adapter);
    const after = await dumpDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([[]]);
    expect(await readUserVersion(adapter)).toBe(22);
    expect(await readColumns(adapter)).toEqual(KEPT_COLUMNS);
    expect(await adapter.getAllAsync(KEPT_SELECT)).toEqual(keptRow);
    expect(keptRow).toEqual([
      {
        can_show_persistent_notification: 1,
        execution_mode: 'android_foreground_service',
        id: 1,
        last_attempt_at: 2000,
        last_cycle_id: 'native-cycle-9',
        last_cycle_stage: 'reconcile_sent',
        last_error_name: 'ReconcileHttpError',
        last_success_at: 1500,
        registration_status: 'registered',
      },
    ]);
    expect(untouched(after)).toEqual(untouched(before));
    expect(await readLedger(adapter)).toEqual(Array.from({ length: 20 }, () => JOURNAL_MAX_WHEN));
  });

  it('makes a second startup a full no-op that never reaches the migrator', async () => {
    const adapter = await openSeededDevice();
    await prepareForegroundDatabase(adapter);
    const upgraded = await dumpDatabase(adapter);
    GATE_MIGRATOR_LOG.length = 0;

    await prepareForegroundDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toEqual([]);
    expect(await dumpDatabase(adapter)).toEqual(upgraded);
    expect(await readUserVersion(adapter)).toBe(22);
  });

  it('rolls every drop back at readiness 20 when one crashes midway, and the next startup completes', async () => {
    const adapter = await openSeededDevice();
    const keptRow = await adapter.getAllAsync(KEPT_SELECT);
    const fullRow = await adapter.getAllAsync('SELECT * FROM sync_runtime_status');
    const before = await dumpDatabase(adapter);
    const stoppedBeforeTheDrop = await dumpStartupStoppedBeforeTheDrop();
    // The sixth of 27 drops: five columns are already gone inside the transaction when it dies.
    const crashing = createCrashingAdapter(adapter, (source) => /DROP COLUMN last_no_op_reason/.test(source));

    await expect(prepareForegroundDatabase(crashing)).rejects.toThrow('injected failure');

    expect(await readUserVersion(adapter)).toBe(READINESS_20_VERSION);
    expect(await adapter.getAllAsync('SELECT * FROM sync_runtime_status')).toEqual(fullRow);
    expect(untouched(await dumpDatabase(adapter))).toEqual(untouched(before));
    expect(await dumpDatabase(adapter)).toEqual(stoppedBeforeTheDrop);

    await prepareForegroundDatabase(adapter);

    expect(await readUserVersion(adapter)).toBe(22);
    expect(await readColumns(adapter)).toEqual(KEPT_COLUMNS);
    expect(await adapter.getAllAsync(KEPT_SELECT)).toEqual(keptRow);
  });

  it('gives a fresh install the same table through migration 0020', async () => {
    const adapter = createTestSqliteAdapter();

    await prepareForegroundDatabase(adapter);

    expect(GATE_MIGRATOR_LOG).toHaveLength(1);
    expect(GATE_MIGRATOR_LOG[0].some((query) => query.includes('DROP COLUMN `last_pending_row_count`'))).toBe(true);
    expect(await readUserVersion(adapter)).toBe(22);
    expect(await readColumns(adapter)).toEqual(KEPT_COLUMNS);
  });

  it('drops only the dead columns a table holds and opens no transaction when none is left', async () => {
    const adapter = createTestSqliteAdapter();
    await adapter.execAsync(
      'CREATE TABLE sync_runtime_status (id INTEGER PRIMARY KEY, last_attempt_at INTEGER, is_cycle_active INTEGER DEFAULT 0 NOT NULL, last_pending_row_count INTEGER)',
    );
    await adapter.runAsync('INSERT INTO sync_runtime_status (id, last_attempt_at, is_cycle_active, last_pending_row_count) VALUES (1, 42, 1, 3)');

    await dropDeadSyncRuntimeStatusColumns(adapter);

    expect(await readColumns(adapter)).toEqual(['id', 'last_attempt_at']);
    expect(await adapter.getAllAsync('SELECT * FROM sync_runtime_status')).toEqual([{ id: 1, last_attempt_at: 42 }]);

    const execAsync = jest.spyOn(adapter, 'execAsync');
    await dropDeadSyncRuntimeStatusColumns(adapter);

    expect(execAsync).not.toHaveBeenCalled();
  });
});
