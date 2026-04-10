import { getSyncRuntimeGateLabel } from '../sync-runtime-gate.helpers';

describe('getSyncRuntimeGateLabel', () => {
  it('returns explicit label', () => {
    expect(getSyncRuntimeGateLabel('Test label')).toBe('Test label');
  });

  it('returns fallback label', () => {
    expect(getSyncRuntimeGateLabel()).toBeNull();
  });
});
