import { SEASON_RATING_SHEET_COPY, SEASON_RATING_VALUES } from "./season-rating-sheet.constants";
import type {
  SeasonRatingSheetComparison,
  SeasonRatingSheetProps,
  SeasonRatingSheetStatus,
  SeasonRatingValue,
} from "./season-rating-sheet.types";

/**
 * Resolves the preselected rating shown in the sheet.
 * Pending local intent wins because the user must see intended offline truth before confirmed bridge truth.
 */
export function getInitialSeasonRatingSelection(
  pendingRating: number | null,
  bridgeRating: number | null,
): SeasonRatingValue | null {
  const value = pendingRating ?? bridgeRating;

  if (value == null || !SEASON_RATING_VALUES.includes(value as SeasonRatingValue)) {
    return null;
  }

  return value as SeasonRatingValue;
}

/**
 * Builds the comparison between the saved note and the draft selected in the sheet.
 * Returns null unless both values exist and differ, so an unchanged or first note draws no comparison;
 * the returned labels are the numbers alone and the words live in the spoken label.
 */
export function buildSeasonRatingComparison(
  savedRating: SeasonRatingValue | null,
  selectedRating: SeasonRatingValue | null,
): SeasonRatingSheetComparison | null {
  if (savedRating === null || selectedRating === null || savedRating === selectedRating) {
    return null;
  }

  return {
    savedValueLabel: String(savedRating),
    draftValueLabel: String(selectedRating),
    accessibilityLabel: `${SEASON_RATING_SHEET_COPY.comparisonSavedLabel} ${savedRating}. ${SEASON_RATING_SHEET_COPY.comparisonDraftLabel} ${selectedRating}.`,
  };
}

/**
 * Decides whether the save action is rendered.
 * Only a draft that differs from the saved note may show it; the action is never drawn in a disabled state.
 */
export function isSeasonRatingSaveVisible(
  savedRating: SeasonRatingValue | null,
  selectedRating: SeasonRatingValue | null,
): boolean {
  return selectedRating !== null && selectedRating !== savedRating;
}


/**
 * Derives pending or repair status messaging for one season rating intent.
 * The copy makes local queue truth explicit so the sheet never implies bridge confirmation.
 */
export function buildSeasonRatingSheetStatus(
  props: Pick<SeasonRatingSheetProps, "pendingStatus" | "pendingFailureKind">,
): SeasonRatingSheetStatus | null {
  if (props.pendingStatus === "pending") {
    return {
      kind: "pending",
      label: SEASON_RATING_SHEET_COPY.pendingTitle,
      description: SEASON_RATING_SHEET_COPY.pendingDescription,
    };
  }

  if (props.pendingStatus === "failed") {
    return {
      kind: "failed",
      label: SEASON_RATING_SHEET_COPY.failedTitle,
      description: SEASON_RATING_SHEET_COPY.failedDescription,
    };
  }

  return null;
}
