import {
  getLastChangelogId,
  shouldPersistLastChangelogId,
} from '../../../src/features/sync/last-changelog.helpers';

describe('last changelog helpers', () => {
  it('getLastChangelogId usa 0 cuando la config no tiene valor', () => {
    expect(getLastChangelogId(null)).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: null })).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: undefined })).toBe(0);
  });

  it('getLastChangelogId devuelve el valor persistido cuando existe', () => {
    expect(getLastChangelogId({ lastChangelogId: 42 })).toBe(42);
  });

  it('getLastChangelogId sanea valores inválidos y cae a 0', () => {
    expect(getLastChangelogId({ lastChangelogId: Number.NaN })).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: Number.POSITIVE_INFINITY })).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: 'last_changelog_id' as never })).toBe(0);
  });

  it('getLastChangelogId sanea cursores corrompidos como timestamps a 0', () => {
    expect(getLastChangelogId({ lastChangelogId: 1_710_000_001_000 })).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: 1_000_000_000_001 })).toBe(0);
    expect(getLastChangelogId({ lastChangelogId: 1_000_000_000_000 })).toBe(1_000_000_000_000);
  });

  it('shouldPersistLastChangelogId solo persiste avances reales', () => {
    expect(shouldPersistLastChangelogId(0, 0)).toBe(false);
    expect(shouldPersistLastChangelogId(5, 4)).toBe(false);
    expect(shouldPersistLastChangelogId(5, 5)).toBe(false);
    expect(shouldPersistLastChangelogId(5, 6)).toBe(true);
  });
});
