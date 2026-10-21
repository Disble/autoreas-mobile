import { CLOSED_SHEET_RESYNC } from './closed-sheet-resync.constants';
import type { ClosedSheetResyncInput } from './closed-sheet-resync.types';

/**
 * Decides whether a sheet must be moved to its new closed position: only when that position really
 * changed (a resize, not the first measurement), HeroUI says the sheet is closed, and gorhom is not
 * already moving it. Runs on the UI thread.
 */
export function shouldResyncClosedSheet(input: ClosedSheetResyncInput): boolean {
  'worklet';
  const { closedPosition, previousClosedPosition, isOpen, animationStatus } = input;
  return (
    closedPosition !== undefined &&
    previousClosedPosition !== undefined &&
    previousClosedPosition !== null &&
    closedPosition !== previousClosedPosition &&
    !isOpen &&
    animationStatus !== CLOSED_SHEET_RESYNC.runningStatus
  );
}
