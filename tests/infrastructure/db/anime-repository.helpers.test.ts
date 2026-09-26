import { buildOptionalAnimeSyncColumns } from '../../../src/infrastructure/db/anime-repository/anime-repository.helpers';

describe('buildOptionalAnimeSyncColumns', () => {
  // `toStrictEqual` (not `toEqual`) throughout: an omitted column must be an ABSENT key, not a
  // present key holding `undefined` -- `toEqual` treats `{ x: undefined }` and `{}` as equal and
  // would not catch that regression, which is exactly the "never a fabricated value" contract
  // the JSDoc above describes.
  it('includes neither column when both are omitted, so onConflictDoUpdate leaves them untouched', () => {
    expect(buildOptionalAnimeSyncColumns()).toStrictEqual({});
    expect(Object.keys(buildOptionalAnimeSyncColumns())).toEqual([]);
  });

  it('includes only lastAppliedChangeMs when only guardMs is supplied', () => {
    expect(buildOptionalAnimeSyncColumns(500)).toStrictEqual({ lastAppliedChangeMs: 500 });
  });

  it('includes only bridgeModifiedAt when only bridgeModifiedAt is supplied', () => {
    expect(buildOptionalAnimeSyncColumns(undefined, 999)).toStrictEqual({ bridgeModifiedAt: 999 });
  });

  it('includes both columns when both are supplied', () => {
    expect(buildOptionalAnimeSyncColumns(500, 999)).toStrictEqual({
      lastAppliedChangeMs: 500,
      bridgeModifiedAt: 999,
    });
  });

  it('includes a guardMs of 0, a falsy-but-explicit value never defaulted away', () => {
    expect(buildOptionalAnimeSyncColumns(0)).toStrictEqual({ lastAppliedChangeMs: 0 });
  });
});
