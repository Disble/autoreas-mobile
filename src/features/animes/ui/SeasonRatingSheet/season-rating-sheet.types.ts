import type { SeasonRatingFailureKind } from "../../../sync/season-rating-queue.types";

export type SeasonRatingValue = 1 | 2 | 3 | 4 | 5 | 6;

export type SeasonRatingSheetStatusKind = "idle" | "pending" | "failed";

export interface SeasonRatingSheetStatus {
  readonly kind: SeasonRatingSheetStatusKind;
  readonly label: string;
  readonly description: string;
}

export interface SeasonRatingSheetBridgeSummary {
  readonly title: string;
  readonly valueLabel: string;
}

export interface SeasonRatingSheetViewModel {
  readonly isOpen: boolean;
  readonly animeTitle: string;
  readonly selectedRating: SeasonRatingValue | null;
  readonly bridgeSummary: SeasonRatingSheetBridgeSummary;
  readonly status: SeasonRatingSheetStatus | null;
  readonly ratingOptions: readonly SeasonRatingValue[];
  readonly isSubmitDisabled: boolean;
}

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
