import type { SQLiteDatabase } from 'expo-sqlite';
import {
  dismissAnimeFoldersHint,
  saveAnimeFoldersRoot,
  toAnimeFoldersPreferences,
} from '../../../src/features/anime-folders/anime-folders-preferences.helpers';
import {
  createDrizzleDb,
  runMigrations,
  withLocalWrite,
} from '../../../src/infrastructure/db/client/client.helpers';
import { appPreferences } from '../../../src/infrastructure/db/schema';
import {
  applyMigrationFiles,
  createTestSqliteAdapter,
} from '../../support/sqlite-adapter.helpers';

// Only the native-runtime seam is mocked, to hand drizzle a node:sqlite handle; the upserts run
// against a real SQLite database created by the app's own repair pipeline.
jest.mock('../../../src/infrastructure/db/native-runtime/native-runtime.helpers', () => ({
  getDrizzleFactory: () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so the helper must be required lazily inside the factory.
    require('../../support/drizzle-test-factory.helpers').createTestDrizzleFactory(),
  getDrizzleMigrator: () => async () => undefined,
  getOpenDatabaseSync: () => () => undefined,
}));

/** Tree uri the picker returns for the SD card anime root. */
const ROOT_URI = 'content://com.android.externalstorage.documents/tree/0123-4567%3AVideos%2FAnime';

/** Creates a fully prepared database holding no `app_preferences` row. */
async function createPreparedDatabase(): Promise<SQLiteDatabase> {
  const adapter = createTestSqliteAdapter();
  await applyMigrationFiles(adapter);
  await runMigrations(adapter);

  return adapter;
}

/** Reads the singleton row through drizzle and the pure mapper, as the feature hook does. */
async function readPreferences(rawDb: SQLiteDatabase) {
  const rows = await createDrizzleDb(rawDb).select().from(appPreferences).limit(1);

  return { preferences: toAnimeFoldersPreferences(rows[0]), row: rows[0] };
}

describe('toAnimeFoldersPreferences', () => {
  it('treats an absent row as no root and a hint not yet dismissed', () => {
    expect(toAnimeFoldersPreferences(null)).toEqual({ rootUri: null, hintDismissedAt: null });
    expect(toAnimeFoldersPreferences(undefined)).toEqual({ rootUri: null, hintDismissedAt: null });
  });
});

describe('saveAnimeFoldersRoot', () => {
  it('stores the chosen root on a device without preferences', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => saveAnimeFoldersRoot(db, ROOT_URI));

    const { preferences } = await readPreferences(rawDb);
    expect(preferences.rootUri).toBe(ROOT_URI);
  });

  it('replaces a previous root and keeps the battery dialog history', async () => {
    const rawDb = await createPreparedDatabase();
    await rawDb.runAsync(
      'INSERT INTO app_preferences (id, battery_prompt_shown_at, anime_folders_root_uri) VALUES (1, 1234, ?)',
      'content://old',
    );

    await withLocalWrite(rawDb, (db) => saveAnimeFoldersRoot(db, ROOT_URI));

    const { preferences, row } = await readPreferences(rawDb);
    expect(preferences.rootUri).toBe(ROOT_URI);
    expect(row?.batteryPromptShownAt).toBe(1234);
  });
});

describe('dismissAnimeFoldersHint', () => {
  it('records the first dismissal and never moves it forward', async () => {
    const rawDb = await createPreparedDatabase();

    await withLocalWrite(rawDb, (db) => dismissAnimeFoldersHint(db, 1000));
    await withLocalWrite(rawDb, (db) => dismissAnimeFoldersHint(db, 2000));

    const { preferences } = await readPreferences(rawDb);
    expect(preferences.hintDismissedAt).toBe(1000);
  });

  it('keeps the chosen root', async () => {
    const rawDb = await createPreparedDatabase();
    await withLocalWrite(rawDb, (db) => saveAnimeFoldersRoot(db, ROOT_URI));

    await withLocalWrite(rawDb, (db) => dismissAnimeFoldersHint(db, 1000));

    const { preferences } = await readPreferences(rawDb);
    expect(preferences).toEqual({ rootUri: ROOT_URI, hintDismissedAt: 1000 });
  });
});
