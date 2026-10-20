/** Defines the season rating value value shape. */
export type SeasonRatingValue = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Defines the data contract for the change comparison between the saved note and the draft.
 * Only the two numbers are drawn; the spoken label carries the words "guardada" and "nueva".
 */
export interface SeasonRatingSheetComparison {
  readonly savedValueLabel: string;
  readonly draftValueLabel: string;
  readonly accessibilityLabel: string;
}

/**
 * Defines the data contract for season rating sheet view model.
 * It carries the note and its draft only: sync health is reported once, above the list, so the
 * sheet has no status field to narrate it with.
 */
export interface SeasonRatingSheetViewModel {
  readonly isOpen: boolean;
  readonly selectedRating: SeasonRatingValue | null;
  readonly comparison: SeasonRatingSheetComparison | null;
  readonly isSaveVisible: boolean;
  readonly ratingOptions: readonly SeasonRatingValue[];
}

/**
 * Defines the data contract for season rating sheet props.
 * `animeTitle` stays required for the caller's contract even though the sheet no longer repeats it.
 */
export interface SeasonRatingSheetProps {
  readonly isOpen: boolean;
  readonly animeTitle: string;
  readonly bridgeRating: number | null;
  readonly pendingRating: number | null;
  readonly onClose: () => void;
  readonly onSubmit: (rating: SeasonRatingValue) => void;
}
