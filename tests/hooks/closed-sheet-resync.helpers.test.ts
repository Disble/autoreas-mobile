import { shouldResyncClosedSheet } from '../../src/hooks/closed-sheet-resync.helpers';
import type { ClosedSheetResyncInput } from '../../src/hooks/closed-sheet-resync.types';

/** A closed, resting sheet whose closed position moved from landscape to portrait height. */
const ROTATED_CLOSED_SHEET: ClosedSheetResyncInput = {
  closedPosition: 1272,
  previousClosedPosition: 779,
  isOpen: false,
  animationStatus: 0,
};

describe('shouldResyncClosedSheet', () => {
  it('moves a closed, resting sheet when its closed position changed after a rotation', () => {
    expect(shouldResyncClosedSheet(ROTATED_CLOSED_SHEET)).toBe(true);
  });

  it('leaves an open sheet to gorhom', () => {
    expect(shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, isOpen: true })).toBe(false);
  });

  it('leaves a sheet that is already moving, such as one mid-close', () => {
    expect(shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, animationStatus: 1 })).toBe(false);
  });

  it('does nothing on the first measurement or when the position did not change', () => {
    expect(
      shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, previousClosedPosition: undefined }),
    ).toBe(false);
    expect(shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, previousClosedPosition: null })).toBe(
      false,
    );
    expect(shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, previousClosedPosition: 1272 })).toBe(
      false,
    );
    expect(shouldResyncClosedSheet({ ...ROTATED_CLOSED_SHEET, closedPosition: undefined })).toBe(
      false,
    );
  });
});
