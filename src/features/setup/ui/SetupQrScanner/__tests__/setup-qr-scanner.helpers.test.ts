import {
  getSetupQrScannerPermissionMessage,
  getSetupQrScannerPermissionState,
  shouldIgnoreSetupQrScan,
} from '../setup-qr-scanner.helpers';

describe('setup-qr-scanner helpers', () => {
  it('maps a granted permission snapshot to the granted state', () => {
    expect(
      getSetupQrScannerPermissionState({ granted: true, canAskAgain: true }),
    ).toBe('granted');
  });

  it('returns the denied message for blocked camera permissions', () => {
    expect(getSetupQrScannerPermissionMessage('denied')).toContain('No pudimos acceder');
  });

  it('ignores empty or repeated scan values', () => {
    expect(shouldIgnoreSetupQrScan(null, '')).toBe(true);
    expect(shouldIgnoreSetupQrScan('same', 'same')).toBe(true);
    expect(shouldIgnoreSetupQrScan('same', 'other')).toBe(false);
  });
});
