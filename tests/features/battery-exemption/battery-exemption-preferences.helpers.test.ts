import {
  markBatteryPromptShown,
  markBatteryReminderShown,
  toBatteryExemptionPreferences,
} from '../../../src/features/battery-exemption/battery-exemption-preferences.helpers';
import { runMigrations, withLocalWrite } from '../../../src/infrastructure/db/client/client.helpers';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../support/sqlite-adapter.helpers';
import type { SQLiteDatabase } from 'expo-sqlite';

// Only the native-runtime seam is mocked, to hand drizzle a node:sqlite handle; the upserts run
// against a real SQLite database created by the app's own repair pipeline.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
}));

/** Creates a fully prepared database holding no `app_preferences` row. */
async function createPreparedDatabase(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await runMigrations(adapter);

  return adapter;
}

/** Reads the singleton row the way the prompt hook will, through the pure mapper. */
async function readPreferences(rawDb: SQLiteDatabase) {
  const row = await rawDb.getFirstAsync<{
    battery_prompt_shown_at: number | null;
    battery_reminder_shown_at: number | null;
  }>('SELECT battery_prompt_shown_at, battery_reminder_shown_at FROM app_preferences WHERE id = 1');

  return toBatteryExemptionPreferences(
    row
      ? {
          id: 1,
          batteryPromptShownAt: row.battery_prompt_shown_at,
          batteryReminderShownAt: row.battery_reminder_shown_at,
        }
      : null,
  );
}

describe('toBatteryExemptionPreferences', () => {
  it('treats an absent row as never shown', () => {
    expect(toBatteryExemptionPreferences(null)).toEqual({
      promptShownAt: null,
      reminderShownAt: null,
    });
    expect(toBatteryExemptionPreferences(undefined)).toEqual({
      promptShownAt: null,
      reminderShownAt: null,
    });
  });

  it('projects the stored timestamps', () => {
    expect(
      toBatteryExemptionPreferences({
        id: 1,
        batteryPromptShownAt: 100,
        batteryReminderShownAt: 200,
      }),
    ).toEqual({ promptShownAt: 100, reminderShownAt: 200 });
  });
});

describe('markBatteryPromptShown / markBatteryReminderShown', () => {
  it('creates the singleton row when marking the prompt on an empty table', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => markBatteryPromptShown(db, 1_000));

    await expect(readPreferences(rawDb)).resolves.toEqual({
      promptShownAt: 1_000,
      reminderShownAt: null,
    });
  });

  it('never overwrites an existing prompt timestamp', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => markBatteryPromptShown(db, 1_000));
    await withLocalWrite(rawDb, (db) => markBatteryPromptShown(db, 9_000));

    await expect(readPreferences(rawDb)).resolves.toEqual({
      promptShownAt: 1_000,
      reminderShownAt: null,
    });
  });

  it('marks the reminder without touching the prompt timestamp', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => markBatteryPromptShown(db, 1_000));
    await withLocalWrite(rawDb, (db) => markBatteryReminderShown(db, 5_000));

    await expect(readPreferences(rawDb)).resolves.toEqual({
      promptShownAt: 1_000,
      reminderShownAt: 5_000,
    });
  });

  it('never overwrites an existing reminder timestamp', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => markBatteryReminderShown(db, 5_000));
    await withLocalWrite(rawDb, (db) => markBatteryReminderShown(db, 7_000));

    await expect(readPreferences(rawDb)).resolves.toEqual({
      promptShownAt: null,
      reminderShownAt: 5_000,
    });
  });
});
