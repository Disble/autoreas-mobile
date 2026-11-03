import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import type { CoverSweepDependencies } from '../../../../src/features/sync/cover-sweep/cover-sweep.types';
import type { CoverManifest, CoverManifestEntry } from '../../../../src/infrastructure/cover-files';
import { NOW } from './cover-sweep-test.constants';

/** A promise plus its external resolve, for tests that need to hold a bridge call open. */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** Builds one manifest entry fixture, overriding only the fields a case cares about. */
export function buildEntry(overrides: Partial<CoverManifestEntry> = {}): CoverManifestEntry {
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
export function toSources(
  animeIds: readonly string[],
): readonly { animeId: string; sourceKey: string | null }[] {
  return animeIds.map((animeId) => ({ animeId, sourceKey: `source-${animeId}` }));
}

/**
 * Builds a full fake `CoverSweepDependencies`, backed by an in-memory manifest and file set that
 * behave like disk: `writeManifest`/`writeCoverImage`/`deleteCoverFile` mutate the same state
 * `readManifest`/`coverFileExists`/`listCoverFileNames` read back, exactly like the real
 * `expo-file-system` adapter would across two calls in the same process.
 */
export function buildFakeDeps(
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
      seasonMode: false,
    })),
    listCoverInboxEntries: jest.fn(async () => []),
    adoptCoverInboxImage: jest.fn(async () => false),
    discardCoverInboxEntry: jest.fn(async () => undefined),
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
