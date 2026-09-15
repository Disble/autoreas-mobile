import { BridgeUnreachableError } from '../../../../src/infrastructure/api';
import {
  buildCoverUriMap,
  computeTransientDelayMs,
  pruneInactiveCoverEntries,
  resolveCoverManifestEntry,
  selectCoverSweepTargets,
  shouldStopCoverSweep,
} from '../../../../src/features/sync/cover-sweep';
import {
  COVER_REVALIDATE_MS,
  COVER_TRANSIENT_BASE_DELAY_MS,
  COVER_TRANSIENT_MAX_DELAY_MS,
  COVER_UNKNOWN_RECHECK_MS,
} from '../../../../src/features/sync/cover-sweep/cover-sweep.constants';
import type { CoverActiveAnimeSource } from '../../../../src/features/sync/cover-sweep/cover-sweep.types';
import type { CoverManifest, CoverManifestEntry } from '../../../../src/infrastructure/cover-files';

/** Fixed clock reading every case in this file computes its expected timestamps relative to. */
const NOW = 1_700_000_000_000;

/** The `sourceKey` every fixture entry/source uses by default, unless a case cares about a mismatch. */
const SOURCE_KEY = 'https://cdn.example.com/anime-1.jpg';

/** Builds one manifest entry fixture, overriding only the fields a case cares about. */
function buildEntry(overrides: Partial<CoverManifestEntry> = {}): CoverManifestEntry {
  return {
    status: 'image',
    fileName: 'anime-1-abc.jpg',
    etag: '"abc"',
    checkedAt: NOW - 1_000,
    nextAttemptAt: NOW - 1_000,
    failureCount: 0,
    sourceKey: SOURCE_KEY,
    ...overrides,
  };
}

/** Builds one active anime source fixture, overriding only the fields a case cares about. */
function buildSource(overrides: Partial<CoverActiveAnimeSource> = {}): CoverActiveAnimeSource {
  return { animeId: 'a1', sourceKey: SOURCE_KEY, ...overrides };
}

describe('selectCoverSweepTargets', () => {
  it('selects ids with no manifest entry', () => {
    const manifest: CoverManifest = { version: 1, entries: {} };

    expect(
      selectCoverSweepTargets(
        [buildSource({ animeId: 'a1' }), buildSource({ animeId: 'a2' })],
        manifest,
        NOW,
      ),
    ).toEqual(['a1', 'a2']);
  });

  it('selects ids whose nextAttemptAt has elapsed', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ nextAttemptAt: NOW - 1 }) },
    };

    expect(selectCoverSweepTargets([buildSource()], manifest, NOW)).toEqual(['a1']);
  });

  it('excludes ids whose nextAttemptAt is still in the future and whose sourceKey matches', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ nextAttemptAt: NOW + 1_000 }) },
    };

    expect(selectCoverSweepTargets([buildSource()], manifest, NOW)).toEqual([]);
  });

  it('selects an id exactly at its nextAttemptAt (inclusive boundary)', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ nextAttemptAt: NOW }) },
    };

    expect(selectCoverSweepTargets([buildSource()], manifest, NOW)).toEqual(['a1']);
  });

  it('preserves the input order (stable order)', () => {
    const manifest: CoverManifest = { version: 1, entries: {} };

    expect(
      selectCoverSweepTargets(
        [buildSource({ animeId: 'c' }), buildSource({ animeId: 'a' }), buildSource({ animeId: 'b' })],
        manifest,
        NOW,
      ),
    ).toEqual(['c', 'a', 'b']);
  });

  it('selects an id whose entry has a future nextAttemptAt but a different sourceKey (a changed portada)', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ nextAttemptAt: NOW + 999_999, sourceKey: 'https://old.example.com/a1.jpg' }) },
    };

    expect(
      selectCoverSweepTargets(
        [buildSource({ sourceKey: 'https://new.example.com/a1.jpg' })],
        manifest,
        NOW,
      ),
    ).toEqual(['a1']);
  });

  it('does NOT select an id whose entry has a future nextAttemptAt and the SAME sourceKey', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry({ nextAttemptAt: NOW + 999_999, sourceKey: SOURCE_KEY }) },
    };

    expect(selectCoverSweepTargets([buildSource({ sourceKey: SOURCE_KEY })], manifest, NOW)).toEqual([]);
  });

  it('selects a legacy entry with no sourceKey even though nextAttemptAt is still in the future', () => {
    const legacyEntry = buildEntry({ nextAttemptAt: NOW + 999_999 });
    delete (legacyEntry as { sourceKey?: string | null }).sourceKey;
    const manifest: CoverManifest = { version: 1, entries: { a1: legacyEntry } };

    expect(selectCoverSweepTargets([buildSource({ sourceKey: SOURCE_KEY })], manifest, NOW)).toEqual(['a1']);
  });
});

describe('computeTransientDelayMs', () => {
  it('uses retryAfterMs verbatim when provided', () => {
    expect(computeTransientDelayMs(1, 12_345)).toBe(12_345);
    expect(computeTransientDelayMs(5, 0)).toBe(0);
  });

  it('backs off exponentially from the base delay when retryAfterMs is null', () => {
    expect(computeTransientDelayMs(1, null)).toBe(COVER_TRANSIENT_BASE_DELAY_MS);
    expect(computeTransientDelayMs(2, null)).toBe(COVER_TRANSIENT_BASE_DELAY_MS * 2);
    expect(computeTransientDelayMs(3, null)).toBe(COVER_TRANSIENT_BASE_DELAY_MS * 4);
  });

  it('clamps the exponential backoff at the max delay', () => {
    expect(computeTransientDelayMs(20, null)).toBe(COVER_TRANSIENT_MAX_DELAY_MS);
  });
});

describe('resolveCoverManifestEntry', () => {
  it('image: writes the new file name, etag, checkedAt, a 7-day nextAttemptAt, and resets failureCount', () => {
    const previous = buildEntry({ failureCount: 3 });

    const entry = resolveCoverManifestEntry(
      previous,
      { kind: 'image', bytes: new Uint8Array([1]), etag: '"new-etag"' },
      NOW,
      'anime-1-newetag.jpg',
      SOURCE_KEY,
    );

    expect(entry).toEqual({
      status: 'image',
      fileName: 'anime-1-newetag.jpg',
      etag: '"new-etag"',
      checkedAt: NOW,
      nextAttemptAt: NOW + COVER_REVALIDATE_MS,
      failureCount: 0,
      sourceKey: SOURCE_KEY,
    });
  });

  it('not_modified: keeps the file name, updates etag/checkedAt, schedules 7 days out', () => {
    const previous = buildEntry({ etag: '"abc"' });

    const entry = resolveCoverManifestEntry(
      previous,
      { kind: 'not_modified', etag: '"abc"' },
      NOW,
      'unused.jpg',
      SOURCE_KEY,
    );

    expect(entry).toEqual({
      status: 'image',
      fileName: previous.fileName,
      etag: '"abc"',
      checkedAt: NOW,
      nextAttemptAt: NOW + COVER_REVALIDATE_MS,
      failureCount: 0,
      sourceKey: SOURCE_KEY,
    });
  });

  it('not_modified: falls back to the previous etag when the response carries none', () => {
    const previous = buildEntry({ etag: '"abc"' });

    const entry = resolveCoverManifestEntry(
      previous,
      { kind: 'not_modified', etag: null },
      NOW,
      'unused.jpg',
      SOURCE_KEY,
    );

    expect(entry.etag).toBe('"abc"');
  });

  it('not_modified: with no previous fileName, schedules an immediate retry instead of trusting it', () => {
    const previous = buildEntry({ fileName: null, status: 'transient' });

    const entry = resolveCoverManifestEntry(
      previous,
      { kind: 'not_modified', etag: '"abc"' },
      NOW,
      'unused.jpg',
      SOURCE_KEY,
    );

    expect(entry.status).toBe('transient');
    expect(entry.fileName).toBeNull();
    expect(entry.etag).toBeNull();
    expect(entry.nextAttemptAt).toBe(NOW);
  });

  it('absent: clears the file name and etag, schedules 7 days out', () => {
    const previous = buildEntry();

    const entry = resolveCoverManifestEntry(previous, { kind: 'absent' }, NOW, 'unused.jpg', SOURCE_KEY);

    expect(entry).toEqual({
      status: 'absent',
      fileName: null,
      etag: null,
      checkedAt: NOW,
      nextAttemptAt: NOW + COVER_REVALIDATE_MS,
      failureCount: 0,
      sourceKey: SOURCE_KEY,
    });
  });

  it('unknown: KEEPS the previous fileName and etag, schedules 24h out', () => {
    const previous = buildEntry({ status: 'image', fileName: 'anime-1-abc.jpg', etag: '"abc"' });

    const entry = resolveCoverManifestEntry(previous, { kind: 'unknown' }, NOW, 'unused.jpg', SOURCE_KEY);

    expect(entry).toEqual({
      status: 'unknown',
      fileName: 'anime-1-abc.jpg',
      etag: '"abc"',
      checkedAt: NOW,
      nextAttemptAt: NOW + COVER_UNKNOWN_RECHECK_MS,
      failureCount: 0,
      sourceKey: SOURCE_KEY,
    });
  });

  it('unknown: tolerates no previous entry', () => {
    const entry = resolveCoverManifestEntry(null, { kind: 'unknown' }, NOW, 'unused.jpg', SOURCE_KEY);

    expect(entry.fileName).toBeNull();
    expect(entry.etag).toBeNull();
  });

  it('transient: keeps previous fileName/etag/checkedAt/status, increments failureCount, schedules via computeTransientDelayMs', () => {
    const previous = buildEntry({ status: 'image', failureCount: 1, checkedAt: 500 });

    const entry = resolveCoverManifestEntry(
      previous,
      { kind: 'transient', status: 503, retryAfterMs: null },
      NOW,
      'unused.jpg',
      SOURCE_KEY,
    );

    expect(entry.status).toBe('image');
    expect(entry.fileName).toBe(previous.fileName);
    expect(entry.etag).toBe(previous.etag);
    expect(entry.checkedAt).toBe(500);
    expect(entry.failureCount).toBe(2);
    expect(entry.nextAttemptAt).toBe(NOW + computeTransientDelayMs(2, null));
  });

  it('transient: uses status "transient" when there is no previous entry', () => {
    const entry = resolveCoverManifestEntry(
      null,
      { kind: 'transient', status: 503, retryAfterMs: 5_000 },
      NOW,
      'unused.jpg',
      SOURCE_KEY,
    );

    expect(entry.status).toBe('transient');
    expect(entry.fileName).toBeNull();
    expect(entry.failureCount).toBe(1);
    expect(entry.nextAttemptAt).toBe(NOW + 5_000);
  });

  describe('sourceKey bookkeeping (every kind stores the sourceKey the request was made for)', () => {
    const NEW_SOURCE_KEY = 'https://cdn.example.com/anime-1-new.jpg';

    it('image', () => {
      const entry = resolveCoverManifestEntry(
        null,
        { kind: 'image', bytes: new Uint8Array([1]), etag: '"etag"' },
        NOW,
        'anime-1.jpg',
        NEW_SOURCE_KEY,
      );

      expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);
    });

    it('not_modified (with a previous file)', () => {
      const previous = buildEntry({ sourceKey: 'https://old.example.com/a1.jpg' });

      const entry = resolveCoverManifestEntry(
        previous,
        { kind: 'not_modified', etag: '"abc"' },
        NOW,
        'unused.jpg',
        NEW_SOURCE_KEY,
      );

      expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);
    });

    it('absent', () => {
      const entry = resolveCoverManifestEntry(null, { kind: 'absent' }, NOW, 'unused.jpg', null);

      expect(entry.sourceKey).toBeNull();
    });

    it('unknown', () => {
      const entry = resolveCoverManifestEntry(null, { kind: 'unknown' }, NOW, 'unused.jpg', NEW_SOURCE_KEY);

      expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);
    });

    it('transient', () => {
      const entry = resolveCoverManifestEntry(
        null,
        { kind: 'transient', status: 503, retryAfterMs: null },
        NOW,
        'unused.jpg',
        NEW_SOURCE_KEY,
      );

      expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);
    });

    it('transient after a source change keeps the NEW key (so backoff applies instead of re-asking every pass)', () => {
      const previous = buildEntry({
        status: 'transient',
        failureCount: 1,
        sourceKey: 'https://old.example.com/a1.jpg',
      });

      const entry = resolveCoverManifestEntry(
        previous,
        { kind: 'transient', status: 503, retryAfterMs: null },
        NOW,
        'unused.jpg',
        NEW_SOURCE_KEY,
      );

      expect(entry.sourceKey).toBe(NEW_SOURCE_KEY);
      expect(entry.failureCount).toBe(2);
    });
  });
});

describe('pruneInactiveCoverEntries', () => {
  it('drops every entry whose id is not active and reports its file for deletion', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: {
        active: buildEntry({ fileName: 'active.jpg' }),
        inactive: buildEntry({ fileName: 'inactive.jpg' }),
      },
    };

    const result = pruneInactiveCoverEntries(manifest, ['active']);

    expect(result.manifest.entries).toEqual({ active: manifest.entries.active });
    expect(result.fileNamesToDelete).toEqual(['inactive.jpg']);
  });

  it('does not report a deletion for a pruned entry with no file', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { inactive: buildEntry({ fileName: null }) },
    };

    const result = pruneInactiveCoverEntries(manifest, []);

    expect(result.fileNamesToDelete).toEqual([]);
  });

  it('keeps every active entry untouched', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: { a1: buildEntry(), a2: buildEntry({ fileName: 'a2.jpg' }) },
    };

    const result = pruneInactiveCoverEntries(manifest, ['a1', 'a2']);

    expect(result.manifest.entries).toEqual(manifest.entries);
    expect(result.fileNamesToDelete).toEqual([]);
  });
});

describe('buildCoverUriMap', () => {
  it('maps every entry with a fileName through toUri', () => {
    const manifest: CoverManifest = {
      version: 1,
      entries: {
        a1: buildEntry({ fileName: 'a1.jpg' }),
        a2: buildEntry({ fileName: null }),
      },
    };

    const map = buildCoverUriMap(manifest, (fileName) => `file:///covers/${fileName}`);

    expect(map).toEqual({ a1: 'file:///covers/a1.jpg' });
  });
});

describe('shouldStopCoverSweep', () => {
  it('stops on unauthorized', () => {
    expect(shouldStopCoverSweep({ kind: 'unauthorized' })).toBe(true);
  });

  it('stops on a thrown BridgeUnreachableError, timeouts included', () => {
    expect(
      shouldStopCoverSweep({ kind: 'error', error: new BridgeUnreachableError('url', new Error('x')) }),
    ).toBe(true);
  });

  it('does not stop on image/absent/unknown/not_modified/transient', () => {
    expect(shouldStopCoverSweep({ kind: 'image', bytes: new Uint8Array(), etag: null })).toBe(false);
    expect(shouldStopCoverSweep({ kind: 'absent' })).toBe(false);
    expect(shouldStopCoverSweep({ kind: 'unknown' })).toBe(false);
    expect(shouldStopCoverSweep({ kind: 'not_modified', etag: null })).toBe(false);
    expect(shouldStopCoverSweep({ kind: 'transient', status: 503, retryAfterMs: null })).toBe(false);
  });

  it('does not stop on a non-bridge thrown error', () => {
    expect(shouldStopCoverSweep({ kind: 'error', error: new Error('boom') })).toBe(false);
  });
});
