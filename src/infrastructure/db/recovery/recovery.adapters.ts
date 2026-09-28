import { Directory, File, Paths } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { createNativeBackgroundFloorStrategy } from '../../../features/sync/native-background-floor';
import { NATIVE_BACKGROUND_FLOOR_MODULE_NAME as SYNC_ENGINE_MODULE_NAME } from '../../../features/sync/native-background-floor/native-background-floor.constants';
import { createNativeForegroundSyncAdapter } from '../../../features/sync/native-foreground-sync-adapter';
import {
  loadDefaultOptionalNativeModuleLoader,
  loadOptionalNativeModule,
} from '../../../features/sync/native-module-loader/native-module-loader.helpers';
import type { OptionalNativeModuleLoader } from '../../../features/sync/native-module-loader/native-module-loader.types';
import { prepareForegroundDatabase } from '../startup/startup.helpers';
import { RESET_TARGET_DATABASE_NAME } from './recovery.constants';
import type { ResetIntent } from './recovery.schema';
import type { DatabaseResetPorts } from './recovery.types';

/** Names the document-directory folder that holds the durable reset intent. */
export const RESET_INTENT_DIRECTORY_NAME = 'recovery';

/**
 * Names the durable reset-intent file.
 *
 * It lives in the document directory, never inside the SQLite folder and never inside the database
 * file, so deleting the database cannot delete the intent that is supposed to survive it.
 */
export const RESET_INTENT_FILE_NAME = 'database-reset-intent.json';

/**
 * Names the folder `expo-sqlite` opens default-path databases in.
 *
 * `SQLiteModule` reports `defaultDatabaseDirectory` as the `SQLite` child of the app's persistent
 * files directory on Android and of the document directory on iOS, which is the same parent
 * `Paths.document` resolves to, so this is the directory the application database actually lives
 * in rather than a second opinion about it.
 */
export const SQLITE_DIRECTORY_NAME = 'SQLite';

/**
 * Names the sidecar suffixes that must never survive the application database's deletion.
 *
 * `-wal` and `-shm` are the WAL mode's own pair and the exact corruption class this reset exists
 * to remove: a stale `-wal` beside a freshly created database can have its frames applied to the
 * new file. They are asserted, not assumed, because the native deletion is the only step whose
 * failure mode is a silent success.
 */
export const DATABASE_SIDECAR_SUFFIXES = ['-wal', '-shm'] as const;

/**
 * Defines the raw native surface this adapter needs from the local `SyncEngine` Expo module.
 *
 * The payload is `unknown` on purpose: the bridge cannot type-check a dictionary, so the adapter
 * validates the shape it actually received instead of trusting a declared type.
 */
export interface ResetNativeDatabaseModule {
  /**
   * Deletes the application database together with every SQLite sidecar through Android's own
   * `SQLiteDatabase.deleteDatabase`, resolving `{ deleted: boolean }` and never rejecting for an
   * already-missing database.
   */
  readonly deleteAppDatabase: () => Promise<unknown>;
}

/** Defines the injectable seams of the production reset ports. */
export interface CreateDatabaseResetAdaptersParams {
  /**
   * Supplies the connection the provider opened, or `null` when none is open.
   *
   * `expo-sqlite` refuses to delete a database while a cached connection for its path exists, so a
   * reset that cannot close the live connection cannot delete anything. Returning `null` is
   * honest, not harmless: the deletion then fails and the durable intent resumes on the next
   * launch instead of silently skipping the destruction.
   */
  readonly getActiveDatabase: () => SQLiteDatabase | null;
  /** Supplies the intent timestamp; defaults to the wall clock. */
  readonly now?: () => number;
  /** Stops the native writers; defaults to unregistering the real foreground and floor strategies. */
  readonly stopNativeWriters?: () => Promise<void>;
  /**
   * Test seam: overrides the lazy `expo-modules-core` lookup of the local `SyncEngine` module.
   *
   * It mirrors the background-floor strategy's own seam so the reset has no second lookup idiom,
   * and it is what lets the adapter tests drive the native deletion without an Expo runtime.
   */
  readonly requireOptionalNativeModule?: OptionalNativeModuleLoader<ResetNativeDatabaseModule>;
}

/**
 * Remembers handles that were already closed in this process.
 *
 * `SQLiteModule.closeAsync` throws `AccessClosedResourceException` when the handle is already
 * closed, so a resumed attempt (or a user retry after a failed stage) would otherwise fail at the
 * close stage on a connection that is already closed. Keyed by handle identity rather than by path
 * or by adapter instance, so a genuinely new connection is still closed while a caller that
 * re-creates the adapters cannot lose the guard.
 */
const closedDatabaseHandles = new WeakSet<SQLiteDatabase>();

/**
 * Reports whether [error] is expo-sqlite's already-closed refusal.
 *
 * The refusal originates as the native `AccessClosedResourceException`
 * (`CodedException("Access to closed resource")`), which crosses the bridge as a plain `Error`
 * carrying that code. The JS class is not exported, so the shape is matched instead of imported --
 * an import would also break on the mocked module in this adapter's own tests.
 */
function isAccessClosedResourceError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;
  const haystack =
    `${typeof code === 'string' ? code : ''} ${error.name} ${error.message}`.toLowerCase();

  return haystack.includes('closed resource') || haystack.includes('accessclosedresource');
}

/**
 * Makes a handle this adapter already closed idempotent for its remaining owner.
 *
 * `expo-sqlite`'s suspense provider has no teardown, and its remount chain calls `db.closeAsync()`
 * on the previous connection WITHOUT awaiting or catching the result. A second close that threw
 * `AccessClosedResourceException` would therefore surface as an unhandled promise rejection the
 * instant the reset remounts the provider. Patching the closed handle's own method is what keeps
 * that later close from rejecting; the WeakSet still guards this adapter's own repeats.
 */
function makeClosedHandleIdempotent(database: SQLiteDatabase): void {
  try {
    Object.defineProperty(database, 'closeAsync', {
      configurable: true,
      value: (): Promise<void> => Promise.resolve(),
      writable: true,
    });
  } catch {
    // A non-configurable handle cannot be patched; the WeakSet still keeps this adapter correct.
  }
}

/**
 * Closes [database] exactly once, tolerating a handle the provider already closed.
 *
 * A close that genuinely fails -- anything that is not the already-closed refusal -- rethrows, so
 * the orchestrator reports a failed `close_connections` and NEVER reaches the deletion. The
 * database must never be deleted while a connection that could still touch its WAL is open.
 */
async function closeDatabaseHandle(database: SQLiteDatabase): Promise<void> {
  if (closedDatabaseHandles.has(database)) {
    return;
  }

  try {
    await database.closeAsync();
  } catch (error) {
    if (!isAccessClosedResourceError(error)) {
      throw error;
    }
  }

  closedDatabaseHandles.add(database);
  makeClosedHandleIdempotent(database);
}

/** Builds the folder that holds the durable reset intent. */
function createResetIntentDirectory(): Directory {
  return new Directory(Paths.document, RESET_INTENT_DIRECTORY_NAME);
}

/** Builds the durable reset-intent file reference. */
function createResetIntentFile(): File {
  return new File(createResetIntentDirectory(), RESET_INTENT_FILE_NAME);
}

/** Builds the application database file reference used by the presence probe and the delete check. */
function createDatabaseFile(fileName: string): File {
  return new File(Paths.document, SQLITE_DIRECTORY_NAME, fileName);
}

/**
 * Names the application database files the deletion must leave absent.
 *
 * The main file plus the WAL pair returned by [DATABASE_SIDECAR_SUFFIXES]. The `-journal` and
 * `-mj*` siblings the native API also owns are deliberately not probed: they are not part of the
 * corruption class this assertion protects against, and a WAL/SHM survivor is the one that can be
 * applied to the new database.
 */
function listSurvivingDatabaseFiles(): readonly string[] {
  return [RESET_TARGET_DATABASE_NAME, ...DATABASE_SIDECAR_SUFFIXES.map(
    (suffix) => `${RESET_TARGET_DATABASE_NAME}${suffix}`,
  )].filter((fileName) => createDatabaseFile(fileName).exists);
}

/**
 * Reads the `deleted` flag out of the native deletion payload, or `null` when the answer is not
 * the documented `{ deleted: boolean }` shape.
 *
 * The bridge delivers an untyped dictionary, so a malformed answer is treated as a failure rather
 * than as a silent success.
 */
function readNativeDeletionFlag(raw: unknown): boolean | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }

  const deleted = (raw as { readonly deleted?: unknown }).deleted;

  return typeof deleted === 'boolean' ? deleted : null;
}

/**
 * Resolves the local `SyncEngine` module through its lazy lookup.
 *
 * The lookup happens per deletion rather than once at construction so constructing the adapters
 * never touches `expo-modules-core` -- the same graceful-degradation property every other native
 * sync seam has, and what keeps an Expo Go / iOS / non-prebuilt host from failing at import time.
 */
function resolveResetNativeModule(
  loader: OptionalNativeModuleLoader<ResetNativeDatabaseModule> | undefined,
): ResetNativeDatabaseModule | null {
  const loadModule = loader ?? loadDefaultOptionalNativeModuleLoader<ResetNativeDatabaseModule>();

  return loadOptionalNativeModule(loadModule, SYNC_ENGINE_MODULE_NAME);
}

/**
 * Deletes the named application database through the native API and proves the result on disk.
 *
 * Two failures are surfaced, both as a rejection so the orchestrator reports a failed
 * `database_delete` and keeps its durable intent instead of treating the reset as done:
 *
 * - the native module cannot be resolved, so nothing was deleted at all. This is NOT degraded to a
 *   no-op: an unreachable deletion must fail loudly rather than skip the destructive step.
 * - the native answer is not the documented payload, or one of the three files survives it. A
 *   main-file-only delete (expo-sqlite's `deleteDatabaseAsync`, the defect this adapter replaced)
 *   leaves both `-wal` and `-shm` behind and is exactly what this check catches.
 *
 * The native `deleted` flag itself is deliberately NOT the verdict: it is `false` for a legitimately
 * already-missing database (a resumed reset), so the filesystem is what decides.
 */
async function deleteAppDatabaseThroughNativeApi(
  loader: OptionalNativeModuleLoader<ResetNativeDatabaseModule> | undefined,
): Promise<void> {
  const nativeModule = resolveResetNativeModule(loader);

  if (nativeModule === null) {
    throw new Error('Database reset failed: the native deletion module is unavailable.');
  }

  const deleted = readNativeDeletionFlag(await nativeModule.deleteAppDatabase());

  if (deleted === null) {
    throw new Error('Database reset failed: the native deletion answered an unexpected payload.');
  }

  const survivors = listSurvivingDatabaseFiles();

  if (survivors.length > 0) {
    throw new Error(
      `Database reset failed: the deletion left ${survivors.join(', ')} behind.`,
    );
  }
}

/**
 * Stops every native writer that could still touch the database.
 *
 * The foreground ticker goes first: it is the writer that can be running right now, while the
 * background floor only arms future work. Both are the existing seams the sync runtime registers
 * with, so a reset stops exactly the writers the app started and nothing else.
 */
async function stopRegisteredNativeWriters(): Promise<void> {
  await createNativeForegroundSyncAdapter().unregister();
  await createNativeBackgroundFloorStrategy().unregister();
}

/**
 * Builds the production ports the reset orchestrator runs on.
 *
 * Every port is a thin, named call onto an existing API: the durable intent is plain JSON in the
 * document directory validated by the domain schema, writers stop through the sync feature's own
 * registration seams, the connection closes through `closeAsync`, deletion goes through the native
 * `SyncEngine.deleteAppDatabase()` -- Android's `SQLiteDatabase.deleteDatabase`, which unlinks the
 * main file, `-journal`, `-shm`, `-wal`, the wipe-check file and every `-mj*` sibling in one call
 * and opens no connection, unlike expo-sqlite's `deleteDatabaseAsync`, which removes the main file
 * only and leaves a stale WAL that can be applied to the freshly created database -- and
 * preparation delegates to `prepareForegroundDatabase` instead of restamping readiness here.
 */
export function createDatabaseResetAdapters(
  params: CreateDatabaseResetAdaptersParams,
): DatabaseResetPorts {
  const {
    getActiveDatabase,
    now = Date.now,
    stopNativeWriters = stopRegisteredNativeWriters,
    requireOptionalNativeModule,
  } = params;

  return {
    async readResetIntent(): Promise<unknown> {
      const intentFile = createResetIntentFile();

      if (!intentFile.exists) {
        return null;
      }

      const content = await intentFile.text();

      try {
        return JSON.parse(content) as unknown;
      } catch {
        // The payload is untrusted input, and the domain schema is what decides whether it is
        // usable. An unparseable payload is reported as "no intent" so a half-written record
        // cannot block recovery; a filesystem failure is NOT swallowed and still fails the run.
        return null;
      }
    },

    async writeResetIntent(intent: ResetIntent): Promise<void> {
      // `write` creates a missing file but never a missing folder, so the folder is created first
      // and is created once per run.
      createResetIntentDirectory().create({ intermediates: true });
      createResetIntentFile().write(JSON.stringify(intent));
    },

    async clearResetIntent(): Promise<void> {
      const intentFile = createResetIntentFile();

      if (intentFile.exists) {
        intentFile.delete();
      }
    },

    async isDatabasePresent(): Promise<boolean> {
      return createDatabaseFile(RESET_TARGET_DATABASE_NAME).exists;
    },

    async stopNativeWriters(): Promise<void> {
      await stopNativeWriters();
    },

    async closeDatabaseConnections(): Promise<void> {
      const database = getActiveDatabase();

      if (database === null) {
        return;
      }

      await closeDatabaseHandle(database);
    },

    async deleteDatabase(databaseName: string): Promise<void> {
      if (databaseName !== RESET_TARGET_DATABASE_NAME) {
        // The one place a file is really deleted is also the place that refuses to name anything
        // but the application database, so no caller can reach the telemetry or journal siblings.
        throw new Error('Reset refused: only the application database may be deleted.');
      }

      await deleteAppDatabaseThroughNativeApi(requireOptionalNativeModule);
    },

    async openAndPrepare(): Promise<void> {
      const database = await openDatabaseAsync(RESET_TARGET_DATABASE_NAME);

      try {
        await prepareForegroundDatabase(database);
      } finally {
        // Closing here is what keeps the module's connection cache free, so the next provider
        // open (and any later deletion) is not blocked by a connection this reset opened.
        await database.closeAsync();
      }
    },

    now,
  };
}
