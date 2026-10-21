/** Defines what the closed-sheet reaction reads to decide whether to move a sheet. */
export interface ClosedSheetResyncInput {
  /** gorhom's closed position after the change; undefined before the first layout. */
  readonly closedPosition: number | undefined;
  /** gorhom's closed position before the change; null or undefined on the first run. */
  readonly previousClosedPosition: number | undefined | null;
  /** HeroUI's open state, the only reliable one once the container changed size. */
  readonly isOpen: boolean;
  /** gorhom's `ANIMATION_STATUS` value. */
  readonly animationStatus: number;
}
