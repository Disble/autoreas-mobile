import {
  createDatabaseResetAdapters,
  RESET_INTENT_DIRECTORY_NAME,
  RESET_INTENT_FILE_NAME,
  SQLITE_DIRECTORY_NAME,
} from '../../../../src/infrastructure/db/recovery/recovery.adapters';
import { ResetIntentSchema } from '../../../../src/infrastructure/db/recovery/recovery.schema';
import { RESET_TARGET_DATABASE_NAME } from '../../../../src/infrastructure/db/recovery/recovery.constants';
import { createNativeBackgroundFloorStrategy } from '../../../../src/features/sync/native-background-floor';
import { createNativeForegroundSyncAdapter } from '../../../../src/features/sync/native-foreground-sync-adapter';
import { prepareForegroundDatabase } from '../../../../src/infrastructure/db/startup/startup.helpers';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

jest.mock('expo-sqlite', () => ({
  deleteDatabaseAsync: jest.fn(),
  openDatabaseAsync: jest.fn(),
}));

jest.mock('../../../../src/features/sync/native-foreground-sync-adapter', () => ({
  createNativeForegroundSyncAdapter: jest.fn(),
}));

jest.mock('../../../../src/features/sync/native-background-floor', () => ({
  createNativeBackgroundFloorStrategy: jest.fn(),
}));

jest.mock('../../../../src/infrastructure/db/startup/startup.helpers', () => ({
  prepareForegroundDatabase: jest.fn(),
}));

jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const fakeFileSystem = {
    directories,
    files,
    readFailure: null as Error | null,
    reset(): void {
      directories.clear();
      files.clear();
      fakeFileSystem.readFailure = null;
    },
  };

  /** Joins the URI-ish segments expo-file-system accepts into one path. */
  const joinSegments = (segments: readonly unknown[]): string => {
    const parts = segments.map((segment) =>
      typeof segment === 'string'
        ? segment
        : String((segment as { readonly uri: string }).uri),
    );

    return parts
      .map((part, index) =>
        index === 0 ? part.replace(/\/+$/, '') : part.replace(/^\/+|\/+$/g, ''),
      )
      .join('/');
  };

  class FakeDirectory {
    readonly uri: string;

    constructor(...segments: readonly unknown[]) {
      this.uri = joinSegments(segments);
    }

    get exists(): boolean {
      return directories.has(this.uri);
    }

    create(options?: { readonly intermediates?: boolean }): void {
      if (options?.intermediates !== true && !directories.has(this.uri)) {
        throw new Error(`Directory does not exist: ${this.uri}`);
      }

      directories.add(this.uri);
    }
  }

  class FakeFile {
    readonly uri: string;

    constructor(...segments: readonly unknown[]) {
      this.uri = joinSegments(segments);
    }

    get exists(): boolean {
      return files.has(this.uri);
    }

    async text(): Promise<string> {
      if (fakeFileSystem.readFailure !== null) {
        throw fakeFileSystem.readFailure;
      }

      if (!files.has(this.uri)) {
        throw new Error(`File does not exist: ${this.uri}`);
      }

      return files.get(this.uri) ?? '';
    }

    write(content: string): void {
      files.set(this.uri, content);
    }

    delete(): void {
      if (!files.delete(this.uri)) {
        throw new Error(`File does not exist: ${this.uri}`);
      }
    }
  }

  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: new FakeDirectory('file:///app/files') },
    fakeFileSystem,
  };
});

/** Exposes the fake file system the adapter tests seed and assert against. */
const { fakeFileSystem } = jest.requireMock('expo-file-system') as {
  readonly fakeFileSystem: {
    readonly directories: Set<string>;
    readonly files: Map<string, string>;
    readFailure: Error | null;
    reset: () => void;
  };
};

/** Stands in for the connect-and-prepare step the adapter delegates to `openDatabaseAsync`. */
const openDatabaseAsyncMock = openDatabaseAsync as jest.Mock;
/** Stands in for the foreground preparation the adapter delegates to `prepareForegroundDatabase`. */
const prepareForegroundDatabaseMock = prepareForegroundDatabase as jest.Mock;
/** Stands in for the real foreground-writer registration seam the adapter stops. */
const createNativeForegroundSyncAdapterMock = createNativeForegroundSyncAdapter as jest.Mock;
/** Stands in for the real background-floor registration seam the adapter stops. */
const createNativeBackgroundFloorStrategyMock = createNativeBackgroundFloorStrategy as jest.Mock;

/** Names the resolved intent path every assertion below reasons about. */
const INTENT_FILE_URI = `file:///app/files/${RESET_INTENT_DIRECTORY_NAME}/${RESET_INTENT_FILE_NAME}`;

/** Names the resolved application database path the presence probe reads. */
const DATABASE_FILE_URI = `file:///app/files/${SQLITE_DIRECTORY_NAME}/${RESET_TARGET_DATABASE_NAME}`;

/** Builds the already-closed refusal expo-sqlite's native module throws on a second close. */
function createClosedResourceError(): Error {
  return Object.assign(new Error('Access to closed resource'), {
    code: 'Access to closed resource',
  });
}

/** Builds a fake provider connection with the one member the close port uses. */
function createFakeDatabase(): SQLiteDatabase & { readonly closeAsync: jest.Mock } {
  return {
    closeAsync: jest.fn(async () => undefined),
    databasePath: DATABASE_FILE_URI,
  } as unknown as SQLiteDatabase & { readonly closeAsync: jest.Mock };
}

describe('database reset adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeFileSystem.reset();
    createNativeForegroundSyncAdapterMock.mockReturnValue({
      unregister: jest.fn(async () => undefined),
    });
    createNativeBackgroundFloorStrategyMock.mockReturnValue({
      unregister: jest.fn(async () => undefined),
    });
    prepareForegroundDatabaseMock.mockResolvedValue(undefined);
    openDatabaseAsyncMock.mockResolvedValue(createFakeDatabase());
  });

  it('wires every port the reset orchestrator requires', () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    expect(Object.keys(ports).sort()).toEqual([
      'clearResetIntent',
      'closeDatabaseConnections',
      'deleteDatabase',
      'isDatabasePresent',
      'now',
      'openAndPrepare',
      'readResetIntent',
      'stopNativeWriters',
      'writeResetIntent',
    ]);
  });

  it('persists a schema-valid intent outside the database file and reads it back', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });
    const intent = { reason: 'confirmed_corruption', requestedAt: 1_700_000_000_000 } as const;

    await ports.writeResetIntent(intent);

    expect([...fakeFileSystem.files.keys()]).toEqual([INTENT_FILE_URI]);
    expect(INTENT_FILE_URI).toContain(`/${RESET_INTENT_DIRECTORY_NAME}/`);
    expect(INTENT_FILE_URI).not.toContain(RESET_TARGET_DATABASE_NAME);
    expect(INTENT_FILE_URI).not.toContain(`/${SQLITE_DIRECTORY_NAME}/`);
    expect(fakeFileSystem.directories.has(`file:///app/files/${RESET_INTENT_DIRECTORY_NAME}`)).toBe(
      true,
    );
    expect(ResetIntentSchema.safeParse(JSON.parse(fakeFileSystem.files.get(INTENT_FILE_URI) ?? '')).success).toBe(
      true,
    );
    expect(await ports.readResetIntent()).toEqual(intent);
  });

  it('treats a missing or an unparseable intent as no intent', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    expect(await ports.readResetIntent()).toBeNull();

    fakeFileSystem.files.set(INTENT_FILE_URI, '{ not json');

    expect(await ports.readResetIntent()).toBeNull();
  });

  it('reports a filesystem read error instead of silently re-deciding the reset', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    await ports.writeResetIntent({ reason: 'confirmed_corruption', requestedAt: 1 });
    fakeFileSystem.readFailure = new Error('io failure');

    await expect(ports.readResetIntent()).rejects.toThrow('io failure');
  });

  it('clears the intent and stays idempotent when it is already gone', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    await ports.writeResetIntent({ reason: 'confirmed_corruption', requestedAt: 1 });
    await ports.clearResetIntent();

    expect(fakeFileSystem.files.size).toBe(0);
    await expect(ports.clearResetIntent()).resolves.toBeUndefined();
  });

  it('probes the application database without touching it', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    expect(await ports.isDatabasePresent()).toBe(false);

    fakeFileSystem.files.set(DATABASE_FILE_URI, 'sqlite bytes');

    expect(await ports.isDatabasePresent()).toBe(true);
    expect(fakeFileSystem.files.get(DATABASE_FILE_URI)).toBe('sqlite bytes');
    expect([...fakeFileSystem.files.keys()]).toEqual([DATABASE_FILE_URI]);
  });

  it('stops the native foreground writer before the background floor', async () => {
    const foregroundUnregister = jest.fn(async () => undefined);
    const floorUnregister = jest.fn(async () => undefined);
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    createNativeForegroundSyncAdapterMock.mockReturnValue({ unregister: foregroundUnregister });
    createNativeBackgroundFloorStrategyMock.mockReturnValue({ unregister: floorUnregister });

    await ports.stopNativeWriters();

    expect(foregroundUnregister).toHaveBeenCalledTimes(1);
    expect(floorUnregister).toHaveBeenCalledTimes(1);
    expect(foregroundUnregister.mock.invocationCallOrder[0]).toBeLessThan(
      floorUnregister.mock.invocationCallOrder[0],
    );
  });

  it('closes the live connection once and never closes an already closed handle twice', async () => {
    const database = createFakeDatabase();
    // Captured before the port runs: a successful close patches the handle's own `closeAsync` to
    // stay idempotent for the provider's later remount close, so the live property is no longer
    // the original spy afterwards.
    const closeAsync = database.closeAsync;
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => database });

    await ports.closeDatabaseConnections();
    await ports.closeDatabaseConnections();

    expect(closeAsync).toHaveBeenCalledTimes(1);
  });

  it('tolerates a handle the provider already closed', async () => {
    const database = createFakeDatabase();
    (database.closeAsync as jest.Mock).mockRejectedValueOnce(createClosedResourceError());
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => database });

    await expect(ports.closeDatabaseConnections()).resolves.toBeUndefined();
  });

  it('surfaces a genuine close failure so the reset never deletes while a connection is open', async () => {
    const database = createFakeDatabase();
    (database.closeAsync as jest.Mock).mockRejectedValueOnce(new Error('disk I/O error'));
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => database });

    await expect(ports.closeDatabaseConnections()).rejects.toThrow('disk I/O error');
  });

  it('makes a closed handle idempotent so the provider own later close cannot reject', async () => {
    const database = createFakeDatabase();
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => database });

    await ports.closeDatabaseConnections();

    // expo-sqlite's suspense provider has no teardown and its remount chain calls `db.closeAsync()`
    // on the previous connection WITHOUT awaiting or catching it. That later call must resolve
    // rather than reject with `AccessClosedResourceException` into an unhandled rejection.
    await expect(database.closeAsync()).resolves.toBeUndefined();
  });

  it('closes a fresh connection even after an earlier handle was already closed', async () => {
    const firstDatabase = createFakeDatabase();
    const nextDatabase = createFakeDatabase();
    const firstCloseAsync = firstDatabase.closeAsync;
    const nextCloseAsync = nextDatabase.closeAsync;

    await createDatabaseResetAdapters({
      getActiveDatabase: () => firstDatabase,
    }).closeDatabaseConnections();
    await createDatabaseResetAdapters({
      getActiveDatabase: () => nextDatabase,
    }).closeDatabaseConnections();

    expect(firstCloseAsync).toHaveBeenCalledTimes(1);
    expect(nextCloseAsync).toHaveBeenCalledTimes(1);
  });

  it('resolves the close port when the provider holds no connection', async () => {
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    await expect(ports.closeDatabaseConnections()).resolves.toBeUndefined();
  });

  it('opens and prepares the fresh database and closes the connection it opened', async () => {
    const opened = createFakeDatabase();
    openDatabaseAsyncMock.mockResolvedValue(opened);
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    await ports.openAndPrepare();

    expect(openDatabaseAsyncMock).toHaveBeenCalledWith(RESET_TARGET_DATABASE_NAME);
    expect(prepareForegroundDatabaseMock).toHaveBeenCalledWith(opened);
    expect(opened.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('still closes the connection it opened when preparation fails', async () => {
    const opened = createFakeDatabase();
    openDatabaseAsyncMock.mockResolvedValue(opened);
    prepareForegroundDatabaseMock.mockRejectedValue(new Error('preparation failed'));
    const ports = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    await expect(ports.openAndPrepare()).rejects.toThrow('preparation failed');
    expect(opened.closeAsync).toHaveBeenCalledTimes(1);
  });

  it('uses the injected clock and defaults to the wall clock', () => {
    const injected = createDatabaseResetAdapters({ getActiveDatabase: () => null, now: () => 42 });
    const defaulted = createDatabaseResetAdapters({ getActiveDatabase: () => null });

    expect(injected.now()).toBe(42);
    expect(defaulted.now()).toBeGreaterThan(0);
  });
});
