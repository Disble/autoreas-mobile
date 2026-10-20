import type { SeasonRatingFailureKind } from "../../../sync/season-rating-event.types";

/** Defines the season rating value value shape. */
export type SeasonRatingValue = 1 | 2 | 3 | 4 | 5 | 6;

/** Defines the season rating sheet status kind value shape. */
export type SeasonRatingSheetStatusKind = "idle" | "pending" | "failed";

/** Defines the data contract for season rating sheet status. */
export interface SeasonRatingSheetStatus {
  readonly kind: SeasonRatingSheetStatusKind;
  readonly label: string;
  readonly description: string;
}

/** Defines the data contract for season rating sheet bridge summary. */
export interface SeasonRatingSheetBridgeSummary {
  readonly title: string;
  readonly valueLabel: string;
}

/**
 * Defines the data contract for the change comparison between the saved note and the draft.
 * Only the two numbers are drawn; the spoken label carries the words "guardada" and "nueva".
 */
export interface SeasonRatingSheetComparison {
  readonly savedValueLabel: string;
  readonly draftValueLabel: string;
  readonly accessibilityLabel: string;
}

/** Defines the data contract for season rating sheet view model. */
export interface SeasonRatingSheetViewModel {
  readonly isOpen: boolean;
  readonly selectedRating: SeasonRatingValue | null;
  readonly bridgeSummary: SeasonRatingSheetBridgeSummary;
  readonly status: SeasonRatingSheetStatus | null;
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
  readonly pendingStatus: "pending" | "failed" | null;
  readonly pendingFailureKind: SeasonRatingFailureKind | null;
  readonly onClose: () => void;
  readonly onSubmit: (rating: SeasonRatingValue) => void;
}
