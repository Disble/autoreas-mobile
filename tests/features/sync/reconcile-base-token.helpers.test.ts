import { buildOptimisticBaseKey } from '../../../src/features/sync/reconcile-base-token.helpers';

describe('buildOptimisticBaseKey', () => {
  it('returns an empty object for a NULL token, so the spread emits no base key', () => {
    expect(buildOptimisticBaseKey(null)).toEqual({});
  });

  it('returns { base: 0 } for a stored zero token, a legitimate token, never omitted', () => {
    expect(buildOptimisticBaseKey(0)).toEqual({ base: 0 });
  });

  it('returns { base: <value> } for a nonzero token', () => {
    expect(buildOptimisticBaseKey(1788540735366)).toEqual({ base: 1788540735366 });
  });

  it('the NULL branch omits the key entirely on serialized bytes, not merely at object level', () => {
    // An object-level assertion (`toEqual({})`) passes even if this returned `{ base: null }` --
    // `toEqual` treats an object with an explicit `undefined`/absent key loosely in some
    // matchers. The real invariant is about the SERIALIZED bytes: `JSON.stringify` must never
    // emit the `base` key at all when the token is unknown (invariant 2: Go's `json.Unmarshal`
    // treats `"base":null` as a REAL zero token, not a bypass).
    const serialized = JSON.stringify({ anime_id: 'x', ...buildOptimisticBaseKey(null) });

    expect(serialized).not.toContain('base');
  });
});
