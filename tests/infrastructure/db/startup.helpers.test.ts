import type { SQLiteDatabase } from 'expo-sqlite';
import {
  prepareForegroundDatabase,
  prepareHeadlessDatabase,
  SchemaIncompatibleError,
  EXPECTED_SCHEMA_READINESS_VERSION,
  SchemaValidationError,
} from '../../../src/infrastructure/db/startup';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  runMigrations: jest.fn(),
}));

describe('database startup helpers', () => {
  it('writes durable readiness only after policy, migrations, and schema validation succeed', async () => {
    const events: string[] = [];
    const rawDb = {
      execAsync: jest.fn(async (statement: string) => {
        events.push(statement);
      }),
      getFirstAsync: jest
        .fn()
        .mockImplementationOnce(async () => {
          events.push('readiness-check');
          return { user_version: 0 };
        })
        .mockImplementationOnce(async () => {
          events.push('quick-check');
          return { quick_check: 'ok' };
        })
        .mockImplementationOnce(async () => {
          events.push('table-check');
          return { count: 8 };
        }),
      getAllAsync: jest.fn().mockImplementation(async () => {
        events.push('column-check');
        return [
          { name: 'last_cycle_id' },
          { name: 'is_sync_telemetry_enabled' },
          { name: 'last_applied_change_ms' },
        ];
      }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockImplementationOnce(async () => {
      events.push('migrations');
    });

    await prepareForegroundDatabase(rawDb);

    expect(events).toEqual([
      'PRAGMA busy_timeout = 5000;',
      'PRAGMA journal_mode = WAL;',
      'readiness-check',
      'migrations',
      'quick-check',
      'table-check',
      'column-check',
      'column-check',
      'column-check',
      `PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`,
    ]);
  });

  it('never writes readiness when schema validation fails', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: 0 })
        .mockResolvedValueOnce({ quick_check: 'database disk image is malformed' })
        .mockResolvedValueOnce({ count: 8 }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(prepareForegroundDatabase(rawDb)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('never writes readiness when a required table exists but is missing a required column', async () => {
    // H0Xx: a table surviving in `sqlite_master` proves nothing about which columns a silently
    // skipped migration (poisoned journal `when` gate) would have added. The table-count check
    // alone let a device stamp readiness after 0007-0010 were skipped -- this is the guard that
    // makes that bug class impossible to repeat.
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: 0 })
        .mockResolvedValueOnce({ quick_check: 'ok' })
        .mockResolvedValueOnce({ count: 8 }),
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === 'PRAGMA table_info(sync_runtime_status)') {
          // Missing `last_cycle_id`: the table exists, but a skipped migration never added it.
          return [{ name: 'id' }, { name: 'registration_status' }];
        }

        return [{ name: 'is_sync_telemetry_enabled' }, { name: 'last_applied_change_ms' }];
      }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockResolvedValueOnce(undefined);

    await expect(prepareForegroundDatabase(rawDb)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('skips schema writes when the exact readiness version is already durable', async () => {
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockResolvedValueOnce({ quick_check: 'ok' })
        .mockResolvedValueOnce({ count: 8 }),
      getAllAsync: jest.fn().mockResolvedValue([
        { name: 'last_cycle_id' },
        { name: 'is_sync_telemetry_enabled' },
        { name: 'last_applied_change_ms' },
      ]),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockClear();

    await prepareForegroundDatabase(rawDb);

    expect(runMigrations).not.toHaveBeenCalled();
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('repairs and re-stamps when readiness is already durable but a required column is missing', async () => {
    // The device this guard exists for: a silently skipped migration left the schema short a
    // column, yet readiness was still stamped over it. A stamped version is therefore NOT proof,
    // which is the exact assumption this change disproves. Refusing to start here would turn a
    // silent no-op sync into a hard startup crash on the one device that needs rescuing, so a
    // failed column check on this path must REPAIR instead of throwing.
    let repaired = false;
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockResolvedValue({ quick_check: 'ok', count: 8 }),
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === 'PRAGMA table_info(sync_runtime_status)') {
          return repaired ? [{ name: 'last_cycle_id' }] : [{ name: 'id' }];
        }

        return [{ name: 'is_sync_telemetry_enabled' }, { name: 'last_applied_change_ms' }];
      }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockImplementation(async () => {
      repaired = true;
    });

    await expect(prepareForegroundDatabase(rawDb)).resolves.toBeUndefined();

    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(rawDb.execAsync).toHaveBeenCalledWith(
      `PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`,
    );
  });

  it('gives the repair exactly one chance and never loops when it does not heal the schema', async () => {
    // Repair is attempted once, then the second validation runs UNCAUGHT. Genuine corruption
    // must still fail startup -- this is a rescue path, not a retry loop.
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockResolvedValue({ quick_check: 'ok', count: 8 }),
      getAllAsync: jest.fn().mockImplementation(async (query: string) => {
        if (query === 'PRAGMA table_info(sync_runtime_status)') {
          return [{ name: 'id' }];
        }

        return [{ name: 'is_sync_telemetry_enabled' }, { name: 'last_applied_change_ms' }];
      }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockResolvedValue(undefined);

    await expect(prepareForegroundDatabase(rawDb)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(
      `PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`,
    );
  });

  it('permits headless access only for the exact durable readiness version', async () => {
    const readyDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest.fn().mockResolvedValue({ user_version: EXPECTED_SCHEMA_READINESS_VERSION }),
    } as unknown as SQLiteDatabase;
    const newerDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      // Derived, not a literal: "newer than we understand" has to stay newer as migrations are
      // added, or this case silently turns into the stale one and stops testing anything.
      getFirstAsync: jest
        .fn()
        .mockResolvedValue({ user_version: EXPECTED_SCHEMA_READINESS_VERSION + 1 }),
    } as unknown as SQLiteDatabase;

    await expect(prepareHeadlessDatabase(readyDb)).resolves.toBeUndefined();
    await expect(prepareHeadlessDatabase(newerDb)).rejects.toBeInstanceOf(
      SchemaIncompatibleError,
    );
  });
});

describe('readiness version invariant', () => {
  it('sigue al número de migraciones del journal', () => {
    // Esta guarda existe por un fallo real: la versión era el literal `1`, así que el chequeo
    // de readiness se volvía una compuerta de UN SOLO USO. Un dispositivo con `user_version = 1`
    // salía por el `return` temprano ANTES de `runMigrations`, y toda migración agregada después
    // quedaba sin aplicar EN SILENCIO -- la app corriendo código nuevo contra una tabla vieja,
    // fallando en la primera escritura a una columna que nunca se creó.
    //
    // Atarla al journal hace que agregar una migración suba la versión sola. Este test es lo que
    // impide que alguien la vuelva a fijar a mano.
    const journal = require('../../../src/infrastructure/db/migrations/meta/_journal.json') as {
      entries: readonly unknown[];
    };

    expect(EXPECTED_SCHEMA_READINESS_VERSION).toBe(journal.entries.length);
  });
});
