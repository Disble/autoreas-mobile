import type { SQLiteDatabase } from 'expo-sqlite';
import {
  prepareForegroundDatabase,
  SchemaIntegrityError,
  EXPECTED_SCHEMA_READINESS_VERSION,
  SchemaValidationError,
} from '../../../src/infrastructure/db/startup';
import { runMigrations } from '../../../src/infrastructure/db/client/client.helpers';

jest.mock('../../../src/infrastructure/db/client/client.helpers', () => ({
  runMigrations: jest.fn(),
}));

describe('startup integrity classification', () => {
  it('never writes readiness when post-migration validation finds a malformed image', async () => {
    // Physical damage must stay distinguishable from a logical mismatch even on the unstamped
    // path: the migrator already ran, so this rejection is the only signal the caller gets that
    // the file itself is damaged rather than merely out of date.
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: 0 })
        .mockResolvedValueOnce({ quick_check: 'database disk image is malformed' })
        .mockResolvedValueOnce({ count: 8 }),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockResolvedValue(undefined);

    const rejection = await prepareForegroundDatabase(rawDb).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(SchemaIntegrityError);
    expect((rejection as Error).name).toBe('SchemaIntegrityError');
    // The migrator is allowed to run on THIS path -- the version was unstamped, so preparation
    // legitimately starts there -- but the damaged file must never be re-validated and stamped.
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(rawDb.getFirstAsync).toHaveBeenCalledTimes(3);
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('keeps the healthy stamped path to exactly one quick_check with no migration and no write', async () => {
    // Baseline comparability guard: separating the two failure kinds must not add an integrity
    // probe to the healthy start path. One readiness read, one quick_check, one table count and
    // the column probes, then out.
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
        { name: 'bridge_modified_at' },
        { name: 'conflict_attempt_count' },
        { name: 'fence' },
      ]),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockResolvedValue(undefined);

    await expect(prepareForegroundDatabase(rawDb)).resolves.toBeUndefined();

    const quickCheckQueries = (rawDb.getFirstAsync as jest.Mock).mock.calls
      .map(([statement]) => String(statement))
      .filter((statement) => statement.includes('quick_check'));

    expect(quickCheckQueries).toHaveLength(1);
    expect(runMigrations).not.toHaveBeenCalled();
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('rejects with SchemaIntegrityError and never repairs when a stamped database fails quick_check', async () => {
    // The device failure this task exists for: the main file fails `PRAGMA quick_check` while
    // `user_version` already equals the expected readiness version. Re-running the migrator and
    // re-stamping a physically damaged file is what produced the fatal startup loop, so physical
    // damage must propagate on the first observation instead of entering the repair path.
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockResolvedValue({ quick_check: 'database disk image is malformed', count: 8 }),
      getAllAsync: jest.fn().mockResolvedValue([
        { name: 'last_cycle_id' },
        { name: 'is_sync_telemetry_enabled' },
        { name: 'last_applied_change_ms' },
        { name: 'bridge_modified_at' },
        { name: 'conflict_attempt_count' },
        { name: 'fence' },
      ]),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockResolvedValue(undefined);

    const rejection = await prepareForegroundDatabase(rawDb).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(SchemaIntegrityError);
    expect((rejection as Error).name).toBe('SchemaIntegrityError');
    expect(rejection).not.toBeInstanceOf(SchemaValidationError);
    expect(runMigrations).not.toHaveBeenCalled();
    // Readiness read + the two probes of the FIRST validation only (quick_check and table count).
    // A second validation attempt would add two more, so three pins "no repair, no re-check".
    expect(rawDb.getFirstAsync).toHaveBeenCalledTimes(3);
    const quickCheckQueries = (rawDb.getFirstAsync as jest.Mock).mock.calls
      .map(([statement]) => String(statement))
      .filter((statement) => statement.includes('quick_check'));
    expect(quickCheckQueries).toHaveLength(1);
    expect(rawDb.execAsync).not.toHaveBeenCalledWith(`PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`);
  });

  it('still rejects with SchemaValidationError when the stamped schema is short a required table', async () => {
    // Regression guard for the rescue path: a logical mismatch is NOT corruption, so it keeps
    // falling through to the repair and re-stamp path.
    let repaired = false;
    const rawDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockImplementation(async () => ({ quick_check: 'ok', count: repaired ? 8 : 7 })),
      getAllAsync: jest.fn().mockResolvedValue([
        { name: 'last_cycle_id' },
        { name: 'is_sync_telemetry_enabled' },
        { name: 'last_applied_change_ms' },
        { name: 'bridge_modified_at' },
        { name: 'conflict_attempt_count' },
        { name: 'fence' },
      ]),
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

    const shortDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      getFirstAsync: jest
        .fn()
        .mockResolvedValueOnce({ user_version: EXPECTED_SCHEMA_READINESS_VERSION })
        .mockResolvedValue({ quick_check: 'ok', count: 7 }),
      getAllAsync: jest.fn().mockResolvedValue([{ name: 'last_cycle_id' }]),
    } as unknown as SQLiteDatabase;
    (runMigrations as jest.Mock).mockReset();
    (runMigrations as jest.Mock).mockResolvedValue(undefined);

    await expect(prepareForegroundDatabase(shortDb)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
    expect(runMigrations).toHaveBeenCalledTimes(1);
    expect(shortDb.execAsync).not.toHaveBeenCalledWith(
      `PRAGMA user_version = ${EXPECTED_SCHEMA_READINESS_VERSION};`,
    );
  });
});
