import type { BridgeAnimeCoverResult } from '../../../../src/infrastructure/api';
import { hydrateCoverUris } from '../../../../src/features/sync/cover-sweep';
import { planCoverInboxAdoption } from '../../../../src/features/sync/cover-sweep/cover-inbox.helpers';
import { COVER_REVALIDATE_MS } from '../../../../src/features/sync/cover-sweep/cover-sweep.constants';
import type { CoverSweepDependencies } from '../../../../src/features/sync/cover-sweep/cover-sweep.types';
import type {
  CoverInboxEntry,
  CoverManifest,
  CoverManifestEntry,
} from '../../../../src/infrastructure/cover-files';

/** Fixed time the native prefetch stamped on every inbox fixture. */
const FETCHED_AT = 1_700_000_000_000;

/** Builds one inbox entry fixture, the way the native background prefetch writes it. */
function buildInboxEntry(animeId: string, overrides: Partial<CoverInboxEntry> = {}): CoverInboxEntry {
  return {
    animeId,
    imageFileName: `${animeId}.jpg`,
    etag: '"etag-1234567890abcdef-tail"',
    sourceKey: `/covers/${animeId}.jpg`,
    fetchedAt: FETCHED_AT,
    sidecarFileName: `${animeId}.json`,
    ...overrides,
  };
}

/** Builds one manifest entry fixture, overriding only the fields a case cares about. */
function buildEntry(overrides: Partial<CoverManifestEntry> = {}): CoverManifestEntry {
  return {
    status: 'image',
    fileName: null,
    etag: null,
    checkedAt: null,
    nextAttemptAt: 0,
    failureCount: 0,
    sourceKey: null,
    ...overrides,
  };
}

/**
 * Builds fake cover dependencies over an in-memory manifest, covers directory and inbox, so the
 * adoption reads back exactly what it moved, wrote and discarded.
 */
function buildFakeDeps(initial: {
  manifest?: CoverManifest;
  files?: readonly string[];
  inbox?: readonly CoverInboxEntry[];
  inboxImages?: readonly string[];
  listInbox?: CoverSweepDependencies['listCoverInboxEntries'];
}) {
  let manifest: CoverManifest = initial.manifest ?? { version: 1, entries: {} };
  const files = new Set<string>(initial.files ?? []);
  let inbox = [...(initial.inbox ?? [])];
  const inboxImages = new Set<string>(initial.inboxImages ?? inbox.map((entry) => entry.imageFileName));
  const callLog: string[] = [];
  const publishCalls: Readonly<Record<string, string>>[] = [];

  const deps: CoverSweepDependencies = {
    clock: { now: () => FETCHED_AT },
    bridgeClient: { getAnimeCover: jest.fn(async () => ({ kind: 'absent' }) as BridgeAnimeCoverResult) },
    readManifest: jest.fn(async () => manifest),
    writeManifest: jest.fn(async (next: CoverManifest) => {
      manifest = next;
      callLog.push('writeManifest');
    }),
    writeCoverImage: jest.fn(async (fileName: string) => fileName),
    coverFileExists: jest.fn(async (fileName: string) => files.has(fileName)),
    deleteCoverFile: jest.fn(async (fileName: string) => {
      files.delete(fileName);
    }),
    listCoverFileNames: jest.fn(async () => Array.from(files)),
    getCoverFileUri: jest.fn((fileName: string) => `file:///covers/${fileName}`),
    publishCoverUris: jest.fn((map: Readonly<Record<string, string>>) => {
      publishCalls.push(map);
    }),
    readActiveAnimeCoverSources: jest.fn(async () => []),
    getBridgeConfigSnapshot: jest.fn(async () => null),
    listCoverInboxEntries: initial.listInbox ?? jest.fn(async () => inbox),
    adoptCoverInboxImage: jest.fn(async (imageFileName: string, fileName: string) => {
      if (!inboxImages.delete(imageFileName)) {
        return false;
      }
      files.add(fileName);
      callLog.push(`adopt:${fileName}`);
      return true;
    }),
    discardCoverInboxEntry: jest.fn(async (entry: CoverInboxEntry) => {
      inbox = inbox.filter((candidate) => candidate.sidecarFileName !== entry.sidecarFileName);
      inboxImages.delete(entry.imageFileName);
      callLog.push(`discard:${entry.sidecarFileName}`);
    }),
  };

  return {
    deps,
    getManifest: () => manifest,
    getInbox: () => inbox,
    files,
    callLog,
    publishCalls,
  };
}

describe('planCoverInboxAdoption', () => {
  it('adopts a cover for an anime the manifest does not know, as a fresh image entry', () => {
    const entry = buildInboxEntry('a1');

    const plan = planCoverInboxAdoption({ version: 1, entries: {} }, [entry]);

    expect(plan.adopt).toEqual([
      {
        inboxEntry: entry,
        fileName: 'a1-etag-1234567890a.jpg',
        manifestEntry: {
          status: 'image',
          fileName: 'a1-etag-1234567890a.jpg',
          etag: '"etag-1234567890abcdef-tail"',
          checkedAt: FETCHED_AT,
          nextAttemptAt: FETCHED_AT + COVER_REVALIDATE_MS,
          failureCount: 0,
          sourceKey: '/covers/a1.jpg',
        },
      },
    ]);
    expect(plan.discard).toEqual([]);
  });

  it('names a cover without an ETag after the time it was fetched', () => {
    const plan = planCoverInboxAdoption({ version: 1, entries: {} }, [buildInboxEntry('a1', { etag: null })]);

    expect(plan.adopt[0].fileName).toBe(`a1-${FETCHED_AT}.jpg`);
  });

  it('adopts over an entry that has no file, and discards when the app already has an image', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: {
        noFile: buildEntry({ status: 'transient', fileName: null }),
        hasFile: buildEntry({ fileName: 'hasFile-x.jpg' }),
      },
    };
    const noFile = buildInboxEntry('noFile');
    const hasFile = buildInboxEntry('hasFile');

    const plan = planCoverInboxAdoption(manifest, [noFile, hasFile]);

    expect(plan.adopt.map((adoption) => adoption.inboxEntry)).toEqual([noFile]);
    expect(plan.discard).toEqual([hasFile]);
  });
});

describe('hydrateCoverUris inbox adoption', () => {
  it('adopts a native download, persists it, then clears the inbox and publishes the cover', async () => {
    const { deps, getManifest, getInbox, callLog, publishCalls } = buildFakeDeps({
      inbox: [buildInboxEntry('a1')],
    });

    await hydrateCoverUris(deps);

    expect(getManifest().entries.a1).toMatchObject({ status: 'image', fileName: 'a1-etag-1234567890a.jpg' });
    expect(getInbox()).toEqual([]);
    expect(callLog).toEqual(['adopt:a1-etag-1234567890a.jpg', 'writeManifest', 'discard:a1.json']);
    expect(publishCalls).toEqual([{ a1: 'file:///covers/a1-etag-1234567890a.jpg' }]);
  });

  it('keeps the image the app already has and drops the native duplicate', async () => {
    const manifest: CoverManifest = { version: 1, entries: { a1: buildEntry({ fileName: 'a1-mine.jpg' }) } };
    const { deps, getManifest, getInbox, callLog } = buildFakeDeps({
      manifest,
      files: ['a1-mine.jpg'],
      inbox: [buildInboxEntry('a1')],
    });

    await hydrateCoverUris(deps);

    expect(getManifest()).toEqual(manifest);
    expect(getInbox()).toEqual([]);
    expect(callLog).toEqual(['discard:a1.json']);
  });

  it('drops a sidecar whose image is already gone without touching the manifest', async () => {
    const { deps, getManifest, getInbox, callLog } = buildFakeDeps({
      inbox: [buildInboxEntry('a1')],
      inboxImages: [],
    });

    await hydrateCoverUris(deps);

    expect(getManifest()).toEqual({ version: 1, entries: {} });
    expect(getInbox()).toEqual([]);
    expect(callLog).toEqual(['discard:a1.json']);
  });

  it('still publishes the manifest when the inbox cannot be read', async () => {
    const manifest: CoverManifest = { version: 1, entries: { a1: buildEntry({ fileName: 'a1.jpg' }) } };
    const { deps, publishCalls } = buildFakeDeps({
      manifest,
      files: ['a1.jpg'],
      listInbox: jest.fn(async () => {
        throw new Error('inbox unreadable');
      }),
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await hydrateCoverUris(deps);

    expect(publishCalls).toEqual([{ a1: 'file:///covers/a1.jpg' }]);
    expect(warn).toHaveBeenCalledWith('[cover-sweep] cover inbox adoption failed', expect.any(Error));
    warn.mockRestore();
  });

  it('writes nothing when the inbox is empty', async () => {
    const { deps } = buildFakeDeps({});

    await hydrateCoverUris(deps);

    expect(deps.writeManifest).not.toHaveBeenCalled();
    expect(deps.discardCoverInboxEntry).not.toHaveBeenCalled();
  });
});
