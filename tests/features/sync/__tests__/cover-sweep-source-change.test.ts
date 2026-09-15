import type { SQLiteDatabase } from 'expo-sqlite';
import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import { runCoverSweep } from '../../../../src/features/sync/cover-sweep';
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
  };
}

/**
 * Device regression (root cause 1): `jeG6ebrdtoqgTSpN` was answered `absent` before its bridge
 * `portada` was ever set, so the manifest carries a 7-day `nextAttemptAt` for a `sourceKey: null`
 * source. Sync later wrote the anime's real `portada`, but before this fix `selectCoverSweepTargets`
 * only checked `nextAttemptAt`, so the changed cover silently waited out the rest of the week.
 */
describe('runCoverSweep: a changed portada invalidates a stale absent/nextAttemptAt entry', () => {
  it("re-fetches a cover whose portada changed since it was marked absent, even with days left on its nextAttemptAt (device bug)", async () => {
    const ANIME_ID = 'jeG6ebrdtoqgTSpN';
    const NEW_SOURCE_KEY =
      'https://cdn.myanimelist.net/r/116x180/images/anime/1145/158339.jpg?s=abc123';
    const manifest: CoverManifest = {
      version: 1,
      entries: {
        [ANIME_ID]: buildEntry({
          status: 'absent',
          fileName: null,
          etag: null,
          sourceKey: null,
          nextAttemptAt: NOW + 6 * 24 * 60 * 60 * 1000,
        }),
      },
    };
    const getAnimeCover = jest.fn(async () => ({
      kind: 'image' as const,
      bytes: new Uint8Array([1, 2, 3]),
      etag: '"new-cover-etag"',
    }));
    const { deps, getManifest } = buildFakeDeps(
      {
        readActiveAnimeCoverSources: jest.fn(async () => [{ animeId: ANIME_ID, sourceKey: NEW_SOURCE_KEY }]),
        bridgeClient: { getAnimeCover },
      },
      { manifest, files: [] },
    );

    const summary = await runCoverSweep(FAKE_DB, deps);

    expect(getAnimeCover).toHaveBeenCalledTimes(1);
    expect(summary.fetched).toBe(1);
    const entry = getManifest().entries[ANIME_ID];
    expect(entry.status).toBe('image');
    expect(entry.fileName).not.toBeNull();
    expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);

    getAnimeCover.mockClear();

    // A second pass inside the TTL, with the SAME (now-current) source, makes no request.
    const secondSummary = await runCoverSweep(FAKE_DB, deps);

    expect(getAnimeCover).not.toHaveBeenCalled();
    expect(secondSummary.fetched).toBe(0);
  });
});
