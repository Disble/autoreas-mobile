/**
 * How a closed sheet is moved to its new closed position: with no animation (it is off screen),
 * tagged as gorhom's `ANIMATION_SOURCE.USER` (3), the source its own `close()` uses, and skipped
 * while gorhom's `ANIMATION_STATUS.RUNNING` (1) says the sheet is already moving. gorhom does not
 * export those enums, so their values are pinned here against `@gorhom/bottom-sheet` 5.2.
 */
export const CLOSED_SHEET_RESYNC = {
  animation: { duration: 0 },
  animationSource: 3,
  runningStatus: 1,
} as const;
