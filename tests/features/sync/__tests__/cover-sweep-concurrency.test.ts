import type { SQLiteDatabase } from 'expo-sqlite';
import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import {
  buildCoverUriMap,
  hydrateCoverUris,
  runCoverSweep,
} from '../../../../src/features/sync/cover-sweep';
import type {
  CoverSweepDependencies,
} from '../../../../src/features/sync/cover-sweep/cover-sweep.types';
import type {
  CoverManifest,
  CoverManifestEntry,
} from '../../../../src/infrastructure/cover-files';

/** Fixed clock reading every test builds its manifest timestamps relative to. */
const NOW = 1_700_000_000_000;
/** A dummy `SQLiteDatabase` handle: every dependency that would read it is faked below. */
const FAKE_DB = {} as SQLiteDatabase;

/** A promise plus its external resolve, for tests that need to hold a bridge call open. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** Drains the microtask queue, for tests that need every already-settled `.then` to run before asserting. */
async function flushMicrotasks(times = 20): Promise<void> {
  await Array.from({ length: times }).reduce<Promise<unknown>>(
    (chain) => chain.then(() => Promise.resolve()),
    Promise.resolve(),
  );
}

/** Builds one manifest entry fixture, overriding only the fields a case cares about. */
function buildEntry(overrides: Partial<CoverManifestEntry> = {}): CoverManifestEntry {
  return {
    status: 'image',
    fileName: null,
    etag: null,
    checkedAt: null,
    nextAttemptAt: NOW - 1,
    failureCount: 0,
    ...overrides,
  };
}

/** Builds `readActiveAnimeCoverSources`-shaped fixtures from plain ids, each with its own distinct `sourceKey`. */
function toSources(animeIds: readonly string[]): readonly { animeId: string; sourceKey: string | null }[] {
  return animeIds.map((animeId) => ({ animeId, sourceKey: `source-${animeId}` }));
}

/**
 * Builds a full fake `CoverSweepDependencies`, backed by an in-memory manifest and file set that
 * behave like disk: `writeManifest`/`writeCoverImage`/`deleteCoverFile` mutate the same state
 * `readManifest`/`coverFileExists`/`listCoverFileNames` read back, exactly like the real
 * `expo-file-system` adapter would across two calls in the same process.
 */
function buildFakeDeps(
  overrides: Partial<CoverSweepDependencies> = {},
  initial: { manifest?: CoverManifest; files?: readonly string[] } = {},
) {
  let manifest: CoverManifest = initial.manifest ?? { version: 1, entries: {} };
  const files = new Set<string>(initial.files ?? []);

  const deps: CoverSweepDependencies = {
    clock: { now: () => NOW },
    bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'absent' }) as BridgeAnimeCoverResult) },
    readManifest: jest.fn(async () => manifest),
    writeManifest: jest.fn(async (next: CoverManifest) => {
      manifest = next;
    }),
    writeCoverImage: jest.fn(async (fileName: string, _bytes: Uint8Array) => {
      files.add(fileName);
      return `file:///covers/${fileName}`;
    }),
    coverFileExists: jest.fn(async (fileName: string) => files.has(fileName)),
    deleteCoverFile: jest.fn(async (fileName: string) => {
      files.delete(fileName);
    }),
    listCoverFileNames: jest.fn(async () => Array.from(files)),
    getCoverFileUri: jest.fn((fileName: string) => `file:///covers/${fileName}`),
    publishCoverUris: jest.fn((_map: Readonly<Record<string, string>>) => undefined),
    readActiveAnimeCoverSources: jest.fn(async () => []),
    getBridgeConfigSnapshot: jest.fn(async () => ({
      id: 1,
      ip: '192.168.0.10',
      port: 8080,
      token: 'token-1',
      deviceId: null,
      deviceName: null,
      lastChangelogId: 0,
      isSyncTelemetryEnabled: true,
    })),
    ...overrides,
  };

  return {
    deps,
    getManifest: () => manifest,
    files,
  };
}

/**
 * Regression coverage for the hydrate-vs-sweep race: `runForegroundResyncCycle` calls
 * `hydrateCoverUris()` on every foreground transition, completely independent of whether a sweep
 * from a PREVIOUS transition is still on the network. Every manifest reader/writer/publisher must
 * be serialized (see `runCoverStoreExclusive` in `cover-sweep-lock.ts`), or a hydrate that races a
 * sweep can publish a stale URI map -- or worse, persist a stale manifest over the sweep's fresh
 * one -- pointing the store at a file the sweep already deleted.
 */
describe('hydrateCoverUris / runCoverSweep concurrency (the cover-store lock)', () => {
  it('while a sweep is blocked on the network, a concurrent hydrateCoverUris makes no manifest/publish calls until the sweep settles, and republishes the fresh manifest afterwards', async () => {
    const networkDeferred = createDeferred<BridgeAnimeCoverResult>();
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: null, nextAttemptAt: NOW - 1 }) },
    };
    const { deps, getManifest } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])),
        bridgeClient: { getAnimeCover: jest.fn(() => networkDeferred.promise) },
      },
      { manifest, files: [] },
    );
    const publishCoverUris = deps.publishCoverUris as jest.Mock;

    const sweepPromise = runCoverSweep(FAKE_DB, deps);
    await flushMicrotasks();

    const readManifestCallsBefore = (deps.readManifest as jest.Mock).mock.calls.length;
    const writeManifestCallsBefore = (deps.writeManifest as jest.Mock).mock.calls.length;
    const publishCallsBefore = publishCoverUris.mock.calls.length;

    const hydratePromise = hydrateCoverUris(deps);
    await flushMicrotasks();

    // The concurrent hydrate must be queued behind the sweep, not interleaved with it.
    expect((deps.readManifest as jest.Mock).mock.calls.length).toBe(readManifestCallsBefore);
    expect((deps.writeManifest as jest.Mock).mock.calls.length).toBe(writeManifestCallsBefore);
    expect(publishCoverUris.mock.calls.length).toBe(publishCallsBefore);

    networkDeferred.resolve({ kind: 'image', bytes: new Uint8Array([1]), etag: '"abc"' });

    await sweepPromise;
    await hydratePromise;

    const expectedMap = buildCoverUriMap(getManifest(), deps.getCoverFileUri);
    const lastPublishedMap = publishCoverUris.mock.calls[publishCoverUris.mock.calls.length - 1][0];
    expect(lastPublishedMap).toEqual(expectedMap);
  });

  it('does not deadlock: runCoverSweep resolves even though it awaits its own internal hydrate step', async () => {
    const { deps } = buildFakeDeps({ readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])) });
    let timeoutHandle: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('runCoverSweep did not settle -- possible deadlock')),
        500,
      );
    });

    try {
      await expect(Promise.race([runCoverSweep(FAKE_DB, deps), timeout])).resolves.toBeDefined();
    } finally {
      clearTimeout(timeoutHandle!);
    }
  });

  it('a sweep that rejects still releases the lock for a queued hydrate', async () => {
    const getAnimeCover = jest.fn(async () => {
      throw new Error('boom');
    });
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg' }) },
    };
    const { deps } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])),
        bridgeClient: { getAnimeCover },
      },
      { manifest, files: ['a1.jpg'] },
    );
    const publishCoverUris = deps.publishCoverUris as jest.Mock;

    await expect(runCoverSweep(FAKE_DB, deps)).rejects.toThrow('boom');
    await expect(hydrateCoverUris(deps)).resolves.toBeUndefined();

    const lastPublishedMap = publishCoverUris.mock.calls[publishCoverUris.mock.calls.length - 1][0];
    expect(lastPublishedMap).toEqual({ a1: 'file:///covers/a1.jpg' });
  });

  it('models two concurrent foreground cycles (hydrate, then sweep, exactly as runForegroundResyncCycle sequences them): the store never regresses to a file the sweep already deleted', async () => {
    const networkDeferred = createDeferred<BridgeAnimeCoverResult>();
    const existsDeferred = createDeferred<boolean>();
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1-old.jpg', etag: '"old"', nextAttemptAt: NOW - 1 }) },
    };
    const { deps: baseDeps, files, getManifest } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])),
        bridgeClient: { getAnimeCover: jest.fn(() => networkDeferred.promise) },
      },
      { manifest, files: ['a1-old.jpg'] },
    );

    // Defers exactly the THIRD `coverFileExists` call -- cycle A's initial hydrate (call 1) and
    // cycle A's sweep's own internal hydrate step (call 2) must both resolve immediately so the
    // sweep can reach the network. The third call is whichever hydrate invocation asks about the
    // manifest's single entry next -- cycle B's hydrate, held open here to simulate a real disk
    // read that is still in flight when cycle A's sweep finishes.
    let existsCallCount = 0;
    const deps: CoverSweepDependencies = {
      ...baseDeps,
      coverFileExists: jest.fn(async (fileName: string) => {
        existsCallCount += 1;
        if (existsCallCount === 3) {
          return existsDeferred.promise;
        }
        return files.has(fileName);
      }),
    };
    const publishCoverUris = deps.publishCoverUris as jest.Mock;

    // Cycle A, as `runForegroundResyncCycle` sequences it: hydrate, then (independently) sweep.
    await hydrateCoverUris(deps);
    const sweepA = runCoverSweep(FAKE_DB, deps);
    await flushMicrotasks();

    // The device is foregrounded again while A's sweep is still on the network: cycle B's hydrate.
    const hydrateB = hydrateCoverUris(deps);
    await flushMicrotasks();

    networkDeferred.resolve({ kind: 'image', bytes: new Uint8Array([9]), etag: '"new"' });
    await sweepA;
    await flushMicrotasks();

    const newFileName = getManifest().entries.a1.fileName as string;
    expect(newFileName).not.toBe('a1-old.jpg');
    expect(files.has('a1-old.jpg')).toBe(false);

    existsDeferred.resolve(true);
    await hydrateB;

    const lastPublishedMap = publishCoverUris.mock.calls[publishCoverUris.mock.calls.length - 1][0];
    expect(lastPublishedMap).toEqual({ a1: `file:///covers/${newFileName}` });
    expect(getManifest().entries.a1.fileName).toBe(newFileName);
  });
});
