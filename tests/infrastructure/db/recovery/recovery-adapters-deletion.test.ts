import {
  createDatabaseResetAdapters,
  DATABASE_SIDECAR_SUFFIXES,
  SQLITE_DIRECTORY_NAME,
} from '../../../../src/infrastructure/db/recovery/recovery.adapters';
import { RESET_TARGET_DATABASE_NAME } from '../../../../src/infrastructure/db/recovery/recovery.constants';
import { deleteDatabaseAsync } from 'expo-sqlite';

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

/** Exposes the fake disk the native-deletion assertions observe. */
const { fakeFileSystem } = jest.requireMock('expo-file-system') as {
  readonly fakeFileSystem: {
    readonly directories: Set<string>;
    readonly files: Map<string, string>;
    readFailure: Error | null;
    reset: () => void;
  };
};

/** Stands in for expo-sqlite's own database deletion, which must never be reached. */
const deleteDatabaseAsyncMock = deleteDatabaseAsync as jest.Mock;
/** Supplies the fake `SyncEngine` module the adapter resolves for the native deletion. */
const requireOptionalNativeModuleMock = jest.fn();
/** Records each native `deleteAppDatabase` call the adapter makes. */
const deleteAppDatabaseMock = jest.fn();

/** Names the local Expo module the adapter must resolve for the deletion. */
const NATIVE_MODULE_NAME = 'SyncEngine';

/** Names the resolved application database path the presence probe reads. */
const DATABASE_FILE_URI = `file:///app/files/${SQLITE_DIRECTORY_NAME}/${RESET_TARGET_DATABASE_NAME}`;

/**
 * Names the main database file plus every sidecar the deletion must remove, in the exact order the
 * adapter asserts on them.
 */
const DATABASE_FILE_URIS = [
  RESET_TARGET_DATABASE_NAME,
  ...DATABASE_SIDECAR_SUFFIXES.map((suffix) => `${RESET_TARGET_DATABASE_NAME}${suffix}`),
].map((fileName) => `file:///app/files/${SQLITE_DIRECTORY_NAME}/${fileName}`);

/** Writes the main database file and its WAL pair into the fake disk. */
function seedDatabaseFiles(): void {
  DATABASE_FILE_URIS.forEach((uri) => fakeFileSystem.files.set(uri, 'sqlite bytes'));
}

/**
 * Removes the seeded database files from the fake disk, standing in for Android's own unlink
 * (which expo-sqlite's `deleteDatabaseAsync` does NOT do for the sidecars).
 */
function unlinkDatabaseFiles(): void {
  DATABASE_FILE_URIS.forEach((uri) => fakeFileSystem.files.delete(uri));
}

describe('database reset native deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeFileSystem.reset();
    requireOptionalNativeModuleMock.mockReturnValue({ deleteAppDatabase: deleteAppDatabaseMock });
    deleteAppDatabaseMock.mockImplementation(async () => {
      unlinkDatabaseFiles();
      return { deleted: true };
    });
  });

  it('deletes the database and its WAL sidecars through the native SQLite API, never through expo-sqlite', async () => {
    seedDatabaseFiles();
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await ports.deleteDatabase(RESET_TARGET_DATABASE_NAME);

    // The native helper is the one invoked -- and through the SyncEngine module lookup, so a
    // rename of the module or of the function fails here instead of silently deleting nothing.
    expect(requireOptionalNativeModuleMock).toHaveBeenCalledWith(NATIVE_MODULE_NAME);
    expect(deleteAppDatabaseMock).toHaveBeenCalledTimes(1);
    // The defect this adapter replaced: expo-sqlite's own delete removes the main file ONLY and
    // leaves a stale `-wal`/`-shm` that can be applied to the freshly created database.
    expect(deleteDatabaseAsyncMock).not.toHaveBeenCalled();
    expect([...fakeFileSystem.files.keys()]).toEqual([]);
    DATABASE_FILE_URIS.forEach((uri) => expect(fakeFileSystem.files.has(uri)).toBe(false));
  });

  it('refuses every other database name before the native deletion is even resolved', async () => {
    seedDatabaseFiles();
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase('sync-journal.db')).rejects.toThrow();

    expect(requireOptionalNativeModuleMock).not.toHaveBeenCalled();
    expect(deleteAppDatabaseMock).not.toHaveBeenCalled();
    expect(deleteDatabaseAsyncMock).not.toHaveBeenCalled();
    expect(fakeFileSystem.files.size).toBe(DATABASE_FILE_URIS.length);
  });

  it('tolerates an already-missing database when the native answer reports nothing deleted', async () => {
    deleteAppDatabaseMock.mockResolvedValue({ deleted: false });
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).resolves.toBeUndefined();
    expect(deleteAppDatabaseMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure when the native deletion removes only the main file, the defect being fixed', async () => {
    seedDatabaseFiles();
    // Expo SDK 55's `deleteDatabaseAsync` behavior: the main file is unlinked, the sidecars survive.
    deleteAppDatabaseMock.mockImplementation(async () => {
      fakeFileSystem.files.delete(DATABASE_FILE_URI);
      return { deleted: true };
    });
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).rejects.toThrow(
      'the deletion left autoreas.db-wal, autoreas.db-shm behind',
    );
  });

  it('surfaces a failure when the main database file survives the native deletion', async () => {
    seedDatabaseFiles();
    // The native call reports success but removes nothing at all.
    deleteAppDatabaseMock.mockResolvedValue({ deleted: true });
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).rejects.toThrow(
      'the deletion left autoreas.db, autoreas.db-wal, autoreas.db-shm behind',
    );
  });

  it('surfaces a failure when the native deletion module cannot be resolved', async () => {
    seedDatabaseFiles();
    requireOptionalNativeModuleMock.mockReturnValue(null);
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).rejects.toThrow(
      'the native deletion module is unavailable',
    );
    expect(deleteDatabaseAsyncMock).not.toHaveBeenCalled();
    expect(fakeFileSystem.files.size).toBe(DATABASE_FILE_URIS.length);
  });

  it('surfaces a failure when the native answer is not the documented payload', async () => {
    deleteAppDatabaseMock.mockResolvedValue(null);
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).rejects.toThrow(
      'the native deletion answered an unexpected payload',
    );
  });

  it('surfaces a failure when the native answer omits the deleted flag', async () => {
    deleteAppDatabaseMock.mockResolvedValue({});
    const ports = createDatabaseResetAdapters({
      getActiveDatabase: () => null,
      requireOptionalNativeModule: requireOptionalNativeModuleMock,
    });

    await expect(ports.deleteDatabase(RESET_TARGET_DATABASE_NAME)).rejects.toThrow();
  });
});
