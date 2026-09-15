import type { SQLiteDatabase } from 'expo-sqlite';
import { BridgeUnreachableError } from '../../../../src/infrastructure/api';
import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import { hydrateCoverUris, runCoverSweep } from '../../../../src/features/sync/cover-sweep';
import {
  COVER_REVALIDATE_MS,
  COVER_SWEEP_CONCURRENCY,
  COVER_UNKNOWN_RECHECK_MS,
} from '../../../../src/features/sync/cover-sweep/cover-sweep.constants';
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
  const writeManifestCalls: CoverManifest[] = [];
  const publishCalls: Readonly<Record<string, string>>[] = [];
  /** Records `writeManifest`/`deleteCoverFile` calls in order, so a test can assert deletion never precedes persistence. */
  const callLog: string[] = [];
  let now = NOW;

  const deps: CoverSweepDependencies = {
    clock: { now: () => now },
    bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'absent' }) as BridgeAnimeCoverResult) },
    readManifest: jest.fn(async () => manifest),
    writeManifest: jest.fn(async (next: CoverManifest) => {
      manifest = next;
      writeManifestCalls.push(next);
      callLog.push('writeManifest');
    }),
    writeCoverImage: jest.fn(async (fileName: string, _bytes: Uint8Array) => {
      files.add(fileName);
      return `file:///covers/${fileName}`;
    }),
    coverFileExists: jest.fn(async (fileName: string) => files.has(fileName)),
    deleteCoverFile: jest.fn(async (fileName: string) => {
      files.delete(fileName);
      callLog.push(`deleteCoverFile:${fileName}`);
    }),
    listCoverFileNames: jest.fn(async () => Array.from(files)),
    getCoverFileUri: jest.fn((fileName: string) => `file:///covers/${fileName}`),
    publishCoverUris: jest.fn((map: Readonly<Record<string, string>>) => {
      publishCalls.push(map);
    }),
    readActiveAnimeIds: jest.fn(async () => []),
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
    writeManifestCalls,
    publishCalls,
    callLog,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('hydrateCoverUris', () => {
  it('publishes existing covers with zero network calls', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg' }) },
    };
    const { deps, publishCalls } = buildFakeDeps({}, { manifest, files: ['a1.jpg'] });

    await hydrateCoverUris(deps);

    expect(deps.bridgeClient.getAnimeCover).not.toHaveBeenCalled();
    expect(publishCalls).toEqual([{ a1: 'file:///covers/a1.jpg' }]);
  });

  it('drops the fileName and schedules an immediate retry for an entry whose file vanished', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg', nextAttemptAt: NOW + 999_999 }) },
    };
    const { deps, getManifest } = buildFakeDeps({}, { manifest, files: [] });

    await hydrateCoverUris(deps);

    expect(getManifest().entries.a1).toMatchObject({ fileName: null, nextAttemptAt: 0 });
  });

  it('never throws, even when reading the manifest fails', async () => {
    const { deps } = buildFakeDeps({ readManifest: jest.fn(async () => { throw new Error('disk error'); }) });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(hydrateCoverUris(deps)).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });
});

describe('runCoverSweep', () => {
  it('offline: publishes from the manifest and sends zero requests when the bridge config is missing', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg' }) },
    };
    const { deps, publishCalls } = buildFakeDeps(
      { getBridgeConfigSnapshot: jest.fn(async () => null) },
      { manifest, files: ['a1.jpg'] },
    );

    const summary = await runCoverSweep(FAKE_DB, deps);

    expect(deps.bridgeClient.getAnimeCover).not.toHaveBeenCalled();
    expect(publishCalls[publishCalls.length - 1]).toEqual({ a1: 'file:///covers/a1.jpg' });
    expect(summary.stopped).toBe(false);
  });

  it('stops before reading active ids when the bridge config is missing (hydrate only)', async () => {
    const { deps } = buildFakeDeps({
      getBridgeConfigSnapshot: jest.fn(async () => ({
        id: 1, ip: null, port: null, token: null, deviceId: null, deviceName: null,
        lastChangelogId: 0, isSyncTelemetryEnabled: true,
      })),
    });

    await runCoverSweep(FAKE_DB, deps);

    expect(deps.readActiveAnimeIds).not.toHaveBeenCalled();
  });

  it("removes an inactive anime's entry and file", async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { inactive: buildEntry({ fileName: 'inactive.jpg' }) },
    };
    const { deps, getManifest, files } = buildFakeDeps(
      { readActiveAnimeIds: jest.fn(async () => []) },
      { manifest, files: ['inactive.jpg'] },
    );

    await runCoverSweep(FAKE_DB, deps);

    expect(getManifest().entries.inactive).toBeUndefined();
    expect(files.has('inactive.jpg')).toBe(false);
  });

  it('a 200 writes a file and sets a 7-day next attempt', async () => {
    const { deps, getManifest, files } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: {
        getAnimeCover: jest.fn(async () => ({
          kind: 'image', bytes: new Uint8Array([1, 2, 3]), etag: '"abc"',
        }) as BridgeAnimeCoverResult),
      },
    });

    const summary = await runCoverSweep(FAKE_DB, deps);

    expect(summary.fetched).toBe(1);
    const entry = getManifest().entries.a1;
    expect(entry.status).toBe('image');
    expect(entry.fileName).not.toBeNull();
    expect(files.has(entry.fileName as string)).toBe(true);
    expect(entry.nextAttemptAt).toBe(NOW + COVER_REVALIDATE_MS);
  });

  it('a second pass inside the TTL makes no request', async () => {
    const getAnimeCover = jest.fn(async (): Promise<BridgeAnimeCoverResult> => ({
      kind: 'image', bytes: new Uint8Array([1]), etag: '"abc"',
    }));
    const { deps } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    await runCoverSweep(FAKE_DB, deps);
    getAnimeCover.mockClear();
    await runCoverSweep(FAKE_DB, deps);

    expect(getAnimeCover).not.toHaveBeenCalled();
  });

  it('after the TTL, a revalidation sends the stored quoted etag and a 304 keeps the same URI', async () => {
    const getAnimeCover = jest.fn(async (): Promise<BridgeAnimeCoverResult> => ({
      kind: 'image', bytes: new Uint8Array([1]), etag: '"abc"',
    }));
    const { deps, getManifest, setNow } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    await runCoverSweep(FAKE_DB, deps);
    const firstFileName = getManifest().entries.a1.fileName;

    setNow(NOW + COVER_REVALIDATE_MS + 1);
    getAnimeCover.mockImplementation(async () => ({ kind: 'not_modified', etag: '"abc"' }));

    await runCoverSweep(FAKE_DB, deps);

    expect(getAnimeCover).toHaveBeenLastCalledWith(
      expect.anything(),
      'a1',
      { ifNoneMatch: '"abc"' },
    );
    expect(getManifest().entries.a1.fileName).toBe(firstFileName);
  });

  it('a changed etag produces a new file name and deletes the old file ONLY after writeManifest (cleanup, not the worker)', async () => {
    const getAnimeCover = jest.fn(async () => ({
      kind: 'image' as const, bytes: new Uint8Array([1]), etag: '"aaaaaaaaaaaaaaaa"',
    }));
    const { deps, getManifest, files, setNow, callLog } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    await runCoverSweep(FAKE_DB, deps);
    const oldFileName = getManifest().entries.a1.fileName as string;

    setNow(NOW + COVER_REVALIDATE_MS + 1);
    getAnimeCover.mockImplementation(async () => ({
      kind: 'image', bytes: new Uint8Array([2]), etag: '"bbbbbbbbbbbbbbbb"',
    }));

    await runCoverSweep(FAKE_DB, deps);

    const newFileName = getManifest().entries.a1.fileName as string;
    expect(newFileName).not.toBe(oldFileName);
    expect(files.has(oldFileName)).toBe(false);
    expect(files.has(newFileName)).toBe(true);

    // Call-order proof: the old file's deletion is cleanup, strictly after the manifest that no
    // longer references it was already durable on disk -- never a worker-side delete racing the
    // write, and never a delete that could leave a crash-recovered manifest pointing at nothing.
    const lastWriteManifestIndex = callLog.lastIndexOf('writeManifest');
    const deleteOldFileIndex = callLog.indexOf(`deleteCoverFile:${oldFileName}`);
    expect(deleteOldFileIndex).toBeGreaterThan(-1);
    expect(deleteOldFileIndex).toBeGreaterThan(lastWriteManifestIndex);
  });

  it('a 204 deletes the file in cleanup, after writeManifest', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg' }) },
    };
    const { deps, getManifest, files, callLog } = buildFakeDeps(
      {
        readActiveAnimeIds: jest.fn(async () => ['a1']),
        bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'absent' }) as BridgeAnimeCoverResult) },
      },
      { manifest, files: ['a1.jpg'] },
    );

    await runCoverSweep(FAKE_DB, deps);

    expect(files.has('a1.jpg')).toBe(false);
    expect(getManifest().entries.a1.status).toBe('absent');

    const lastWriteManifestIndex = callLog.lastIndexOf('writeManifest');
    const deleteFileIndex = callLog.indexOf('deleteCoverFile:a1.jpg');
    expect(deleteFileIndex).toBeGreaterThan(-1);
    expect(deleteFileIndex).toBeGreaterThan(lastWriteManifestIndex);
  });

  it('never calls deleteCoverFile before writeManifest, across a pass that replaces one file and removes another', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: {
        a1: buildEntry({ fileName: 'a1-old.jpg', etag: '"aaaaaaaaaaaaaaaa"', nextAttemptAt: NOW - 1 }),
        a2: buildEntry({ fileName: 'a2.jpg', nextAttemptAt: NOW - 1 }),
      },
    };
    const getAnimeCover = jest.fn(async (_connection: unknown, animeId: string) => {
      if (animeId === 'a1') {
        return {
          kind: 'image' as const, bytes: new Uint8Array([9]), etag: '"bbbbbbbbbbbbbbbb"',
        };
      }
      return { kind: 'absent' as const };
    });
    const { deps, files, callLog } = buildFakeDeps(
      {
        readActiveAnimeIds: jest.fn(async () => ['a1', 'a2']),
        bridgeClient: { getAnimeCover },
      },
      { manifest, files: ['a1-old.jpg', 'a2.jpg'] },
    );

    await runCoverSweep(FAKE_DB, deps);

    expect(files.has('a1-old.jpg')).toBe(false);
    expect(files.has('a2.jpg')).toBe(false);

    const firstDeleteIndex = callLog.findIndex((entry) => entry.startsWith('deleteCoverFile:'));
    const firstWriteManifestIndex = callLog.indexOf('writeManifest');
    expect(firstWriteManifestIndex).toBeGreaterThan(-1);
    expect(firstDeleteIndex).toBeGreaterThan(firstWriteManifestIndex);
  });

  it('a 404 keeps the file and schedules 24h', async () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ fileName: 'a1.jpg', etag: '"abc"' }) },
    };
    const { deps, getManifest, files } = buildFakeDeps(
      {
        readActiveAnimeIds: jest.fn(async () => ['a1']),
        bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'unknown' }) as BridgeAnimeCoverResult) },
      },
      { manifest, files: ['a1.jpg'] },
    );

    await runCoverSweep(FAKE_DB, deps);

    expect(files.has('a1.jpg')).toBe(true);
    const entry = getManifest().entries.a1;
    expect(entry.fileName).toBe('a1.jpg');
    expect(entry.nextAttemptAt).toBe(NOW + COVER_UNKNOWN_RECHECK_MS);
  });

  it('a 503 with Retry-After schedules exactly that delay', async () => {
    const { deps, getManifest } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: {
        getAnimeCover: jest.fn(
          async () => ({ kind: 'transient', status: 503, retryAfterMs: 5_000 }) as BridgeAnimeCoverResult,
        ),
      },
    });

    await runCoverSweep(FAKE_DB, deps);

    expect(getManifest().entries.a1.nextAttemptAt).toBe(NOW + 5_000);
  });

  it('a 401 stops the pass and starts no requests beyond the initial concurrent batch, leaving entries untouched', async () => {
    const getAnimeCover = jest.fn(async () => ({ kind: 'unauthorized' }) as BridgeAnimeCoverResult);
    const { deps, getManifest } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1', 'a2', 'a3']),
      bridgeClient: { getAnimeCover },
    });

    const summary = await runCoverSweep(FAKE_DB, deps);

    expect(summary.stopped).toBe(true);
    expect(getAnimeCover).toHaveBeenCalledTimes(COVER_SWEEP_CONCURRENCY);
    expect(getManifest().entries.a1).toBeUndefined();
    expect(getManifest().entries.a2).toBeUndefined();
    expect(getManifest().entries.a3).toBeUndefined();
  });

  it('an unreachable bridge stops the pass', async () => {
    const getAnimeCover = jest.fn(async () => {
      throw new BridgeUnreachableError('http://bridge/cover', new Error('down'));
    });
    const { deps } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    const summary = await runCoverSweep(FAKE_DB, deps);

    expect(summary.stopped).toBe(true);
  });

  it('never runs more than COVER_SWEEP_CONCURRENCY requests in flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const getAnimeCover = jest.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { kind: 'absent' } as BridgeAnimeCoverResult;
    });
    const { deps } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1', 'a2', 'a3', 'a4', 'a5']),
      bridgeClient: { getAnimeCover },
    });

    await runCoverSweep(FAKE_DB, deps);

    expect(maxInFlight).toBeLessThanOrEqual(COVER_SWEEP_CONCURRENCY);
    expect(getAnimeCover).toHaveBeenCalledTimes(5);
  });

  it('a concurrent call returns the SAME in-flight promise (single-flight)', async () => {
    const deferred = createDeferred<BridgeAnimeCoverResult>();
    const getAnimeCover = jest.fn(() => deferred.promise);
    const { deps } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    const first = runCoverSweep(FAKE_DB, deps);
    const second = runCoverSweep(FAKE_DB, deps);

    expect(second).toBe(first);

    deferred.resolve({ kind: 'absent' });
    await first;
    await second;

    expect(getAnimeCover).toHaveBeenCalledTimes(1);
  });

  it('writes the manifest even when a worker throws', async () => {
    const getAnimeCover = jest.fn(async () => {
      throw new Error('boom');
    });
    const { deps, writeManifestCalls } = buildFakeDeps({
      readActiveAnimeIds: jest.fn(async () => ['a1']),
      bridgeClient: { getAnimeCover },
    });

    await expect(runCoverSweep(FAKE_DB, deps)).rejects.toThrow('boom');

    expect(writeManifestCalls.length).toBeGreaterThan(0);
  });
});

