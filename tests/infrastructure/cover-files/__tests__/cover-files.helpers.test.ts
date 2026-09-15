import {
  buildCoverFileName,
  parseCoverManifest,
} from '../../../../src/infrastructure/cover-files/cover-files.helpers';

describe('buildCoverFileName', () => {
  it('builds a file name from the sanitized id and the first 16 hex chars of the etag', () => {
    const name = buildCoverFileName('anime-1', '"3f9ab2c1d4e5f6a7890123456789abcd"', 'fallback');

    expect(name).toBe('anime-1-3f9ab2c1d4e5f6a7.jpg');
  });

  it('strips quotes off the etag before slicing', () => {
    const name = buildCoverFileName('anime-1', '"abc"', 'fallback');

    expect(name).toBe('anime-1-abc.jpg');
  });

  it('uses the fallback token when the etag is null', () => {
    const name = buildCoverFileName('anime-1', null, 'fallback-token');

    expect(name).toBe('anime-1-fallback-token.jpg');
  });

  it('uses the fallback token when the etag is empty after stripping quotes', () => {
    const name = buildCoverFileName('anime-1', '""', 'fallback-token');

    expect(name).toBe('anime-1-fallback-token.jpg');
  });

  it('sanitizes characters outside [A-Za-z0-9_-] deterministically', () => {
    const first = buildCoverFileName('anime/1 x', '"abc"', 'fallback');
    const second = buildCoverFileName('anime/1 x', '"abc"', 'fallback');

    expect(first).toBe(second);
    expect(first).not.toContain('/');
    expect(first).not.toContain(' ');
  });

  it('produces a DIFFERENT file name when the etag changes, so expo-image cache-by-uri sees a new file', () => {
    const first = buildCoverFileName('anime-1', '"aaaaaaaaaaaaaaaa"', 'fallback');
    const second = buildCoverFileName('anime-1', '"bbbbbbbbbbbbbbbb"', 'fallback');

    expect(first).not.toBe(second);
  });

  it('never lets a literal underscore in one id collide with another id escaped into the same digits', () => {
    // Without a fixed-width escape, 'a_20' passes through unchanged while 'a ' becomes 'a_20' via
    // a variable-width hex escape of the space character -- both ids then sanitize to the same
    // name and silently overwrite each other's cover file on disk.
    const first = buildCoverFileName('a_20', '"etag"', 'fallback');
    const second = buildCoverFileName('a ', '"etag"', 'fallback');

    expect(first).not.toBe(second);
  });

  it('passes a 24-hex-character Mongo ObjectId through unchanged', () => {
    const objectId = '507f1f77bcf86cd799439011';

    expect(buildCoverFileName(objectId, '"etag"', 'fallback')).toBe(`${objectId}-etag.jpg`);
  });

  it('is deterministic for the same id containing mixed safe and unsafe characters', () => {
    const first = buildCoverFileName('anime/ id_1', '"etag"', 'fallback');
    const second = buildCoverFileName('anime/ id_1', '"etag"', 'fallback');

    expect(first).toBe(second);
  });

  it('escapes a literal underscore as a fixed-width 4-hex-digit sequence, distinct from passthrough text', () => {
    const name = buildCoverFileName('a_b', '"etag"', 'fallback');

    expect(name).toBe('a_005fb-etag.jpg');
  });

  it('never lets a literal underscore followed by 4 hex digits masquerade as an escaped character', () => {
    // If the underscore itself were allowed to pass through, this literal text would be
    // indistinguishable from the escape produced for a single space character (charCode 0x0020).
    const literalUnderscoreDigits = buildCoverFileName('a_0020b', '"etag"', 'fallback');
    const escapedSpace = buildCoverFileName('a b', '"etag"', 'fallback');

    expect(literalUnderscoreDigits).not.toBe(escapedSpace);
  });
});

describe('parseCoverManifest', () => {
  it('parses a valid v1 manifest', () => {
    const raw = {
      version: 1,
      entries: {
        'anime-1': {
          status: 'image',
          fileName: 'anime-1-abc.jpg',
          etag: '"abc"',
          checkedAt: 1000,
          nextAttemptAt: 2000,
          failureCount: 0,
        },
      },
    };

    expect(parseCoverManifest(raw)).toEqual(raw);
  });

  it('returns an empty manifest for missing input', () => {
    expect(parseCoverManifest(null)).toEqual({ version: 1, entries: {} });
    expect(parseCoverManifest(undefined)).toEqual({ version: 1, entries: {} });
  });

  it('returns an empty manifest for invalid input', () => {
    expect(parseCoverManifest({ not: 'a manifest' })).toEqual({ version: 1, entries: {} });
    expect(parseCoverManifest('not even an object')).toEqual({ version: 1, entries: {} });
  });

  it('returns an empty manifest for the wrong version', () => {
    expect(parseCoverManifest({ version: 2, entries: {} })).toEqual({ version: 1, entries: {} });
  });
});
