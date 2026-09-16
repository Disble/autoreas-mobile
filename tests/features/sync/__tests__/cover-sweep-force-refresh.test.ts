import type { SQLiteDatabase } from 'expo-sqlite';
import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import { runCoverSweep } from '../../../../src/features/sync/cover-sweep';
import { COVER_REVALIDATE_MS } from '../../../../src/features/sync/cover-sweep/cover-sweep.constants';
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
    sourceKey: null,
    ...overrides,
  };
}

/** Builds `readActiveAnimeCoverSources`-shaped fixtures from plain ids, each with its own distinct `sourceKey`. */
function toSources(animeIds: readonly string[]): readonly { animeId: string; sourceKey: string | null }[] {
  return animeIds.map((animeId) => ({ animeId, sourceKey: `source-${animeId}` }));
}

/**
 * Builds a full fake `CoverSweepDependencies`, backed by an in-memory manifest and file set that
 * behave like disk (mirrors the fixture used across the other cover-sweep orchestrator suites).
 */
function buildFakeDeps(
  overrides: Partial<CoverSweepDependencies> = {},
  initial: { manifest?: CoverManifest; files?: readonly string[] } = {},
) {
  let manifest: CoverManifest = initial.manifest ?? { version: 1, entries: {} };
  const files = new Set<string>(initial.files ?? []);
  const callLog: string[] = [];

  const deps: CoverSweepDependencies = {
    clock: { now: () => NOW },
    bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'absent' }) as BridgeAnimeCoverResult) },
    readManifest: jest.fn(async () => manifest),
    writeManifest: jest.fn(async (next: CoverManifest) => {
      manifest = next;
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
    callLog,
  };
}

/**
 * Device regression: a cover replaced on the PC at the SAME source path never changes the manifest
 * entry's `sourceKey`, and its `nextAttemptAt` sits ~7 days out -- an unforced sweep (every
 * pull-to-refresh before this fix included) skips it, so the user never sees the new cover.
 * `runCoverSweep(rawDb, deps, { force: true })` is what a manual refresh now uses to revalidate
 * regardless of the TTL.
 */
describe('runCoverSweep force option', () => {
  const ANIME_ID = 'Gmi386XNGisZWL3F';
  const SOURCE_KEY = 'D:/User/Downloads/bleach-sennen-kessen-hen-kashin-tan.jpg';
  const OLD_FILE_NAME = 'Gmi386XNGisZWL3F-oldetag.jpg';

  /** The device manifest entry: `status: 'image'`, matching sourceKey, due ~7 days from now. */
  function buildDueSoonManifest(overrides: Partial<CoverManifestEntry> = {}): CoverManifest {
    return {
      version: 1,
      entries: {
        [ANIME_ID]: buildEntry({
          status: 'image',
          fileName: OLD_FILE_NAME,
          etag: '"old-etag"',
          sourceKey: SOURCE_KEY,
          nextAttemptAt: NOW + 7 * 24 * 60 * 60 * 1000,
          ...overrides,
        }),
      },
    };
  }

  it('unforced: a matching sourceKey with days left on nextAttemptAt sends no request (TTL regression guard)', async () => {
    const getAnimeCover = jest.fn(async () => ({ kind: 'not_modified', etag: '"old-etag"' }) as BridgeAnimeCoverResult);
    const { deps } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => [{ animeId: ANIME_ID, sourceKey: SOURCE_KEY }]),
        bridgeClient: { getAnimeCover },
      },
      { manifest: buildDueSoonManifest(), files: [OLD_FILE_NAME] },
    );

    await runCoverSweep(FAKE_DB, deps);

    expect(getAnimeCover).not.toHaveBeenCalled();
  });

  it('forced: sends exactly one request carrying the stored etag as ifNoneMatch, even with days left on nextAttemptAt', async () => {
    const getAnimeCover = jest.fn(async () => ({ kind: 'not_modified', etag: '"old-etag"' }) as BridgeAnimeCoverResult);
    const { deps } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => [{ animeId: ANIME_ID, sourceKey: SOURCE_KEY }]),
        bridgeClient: { getAnimeCover },
      },
      { manifest: buildDueSoonManifest(), files: [OLD_FILE_NAME] },
    );

    await runCoverSweep(FAKE_DB, deps, { force: true });

    expect(getAnimeCover).toHaveBeenCalledTimes(1);
    expect(getAnimeCover).toHaveBeenCalledWith(expect.anything(), ANIME_ID, { ifNoneMatch: '"old-etag"' });
  });

  it('forced + not_modified: keeps the fileName and etag, and advances checkedAt', async () => {
    const getAnimeCover = jest.fn(async () => ({ kind: 'not_modified', etag: '"old-etag"' }) as BridgeAnimeCoverResult);
    const { deps, getManifest } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => [{ animeId: ANIME_ID, sourceKey: SOURCE_KEY }]),
        bridgeClient: { getAnimeCover },
      },
      { manifest: buildDueSoonManifest({ checkedAt: NOW - 999_999 }), files: [OLD_FILE_NAME] },
    );

    await runCoverSweep(FAKE_DB, deps, { force: true });

    const entry = getManifest().entries[ANIME_ID];
    expect(entry.fileName).toBe(OLD_FILE_NAME);
    expect(entry.etag).toBe('"old-etag"');
    expect(entry.checkedAt).toBe(NOW);
    expect(entry.nextAttemptAt).toBe(NOW + COVER_REVALIDATE_MS);
  });

  it('forced + a NEW etag: writes the new file, points the entry at it, and deletes the old file in cleanup after writeManifest', async () => {
    const getAnimeCover = jest.fn(async () => ({
      kind: 'image' as const,
      bytes: new Uint8Array([9, 9, 9]),
      etag: '"new-etag"',
    }));
    const { deps, getManifest, files, callLog } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => [{ animeId: ANIME_ID, sourceKey: SOURCE_KEY }]),
        bridgeClient: { getAnimeCover },
      },
      { manifest: buildDueSoonManifest(), files: [OLD_FILE_NAME] },
    );

    await runCoverSweep(FAKE_DB, deps, { force: true });

    const entry = getManifest().entries[ANIME_ID];
    expect(entry.fileName).not.toBe(OLD_FILE_NAME);
    expect(files.has(entry.fileName as string)).toBe(true);
    expect(files.has(OLD_FILE_NAME)).toBe(false);

    const writeManifestIndex = callLog.lastIndexOf('writeManifest');
    const deleteOldFileIndex = callLog.indexOf(`deleteCoverFile:${OLD_FILE_NAME}`);
    expect(deleteOldFileIndex).toBeGreaterThan(writeManifestIndex);
  });

  it('a forced call while an unforced sweep is in flight does not join it, and performs its own pass afterwards', async () => {
    const deferredA = createDeferred<BridgeAnimeCoverResult>();
    let callCount = 0;
    const getAnimeCover = jest.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return deferredA.promise;
      }
      return { kind: 'absent' } as BridgeAnimeCoverResult;
    });
    const { deps } = buildFakeDeps({
      readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])),
      bridgeClient: { getAnimeCover },
    });

    const passA = runCoverSweep(FAKE_DB, deps);
    await flushMicrotasks();

    const passB = runCoverSweep(FAKE_DB, deps, { force: true });

    expect(passB).not.toBe(passA);

    deferredA.resolve({ kind: 'absent' });
    await passA;
    await passB;

    expect(getAnimeCover).toHaveBeenCalledTimes(2);
  });

  it('a later unforced call still joins the forced pass, even after the unforced pass it superseded already settled', async () => {
    const deferredA = createDeferred<BridgeAnimeCoverResult>();
    const deferredB = createDeferred<BridgeAnimeCoverResult>();
    let callCount = 0;
    const getAnimeCover = jest.fn(async () => {
      callCount += 1;
      return callCount === 1 ? deferredA.promise : deferredB.promise;
    });
    const { deps } = buildFakeDeps({
      readActiveAnimeCoverSources: jest.fn(async () => toSources(['a1'])),
      bridgeClient: { getAnimeCover },
    });

    const passA = runCoverSweep(FAKE_DB, deps);
    await flushMicrotasks();

    const passB = runCoverSweep(FAKE_DB, deps, { force: true });
    await flushMicrotasks();

    deferredA.resolve({ kind: 'absent' });
    await passA;
    await flushMicrotasks();

    const passC = runCoverSweep(FAKE_DB, deps);

    expect(passC).toBe(passB);

    deferredB.resolve({ kind: 'absent' });
    await passB;
    await passC;

    expect(getAnimeCover).toHaveBeenCalledTimes(2);
  });
});
