import { SEASON_RATING_SHEET_COPY, SEASON_RATING_VALUES } from "./season-rating-sheet.constants";
import type {
  SeasonRatingSegment,
  SeasonRatingSheetComparison,
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
 * Builds the six ratings of the track with the state each one is drawn in.
 * The saved note stays filled while a different draft is ringed, so both values are visible at once;
 * with nothing saved, a choice is a draft, and with no choice nothing is marked.
 */
export function buildSeasonRatingSegments(
  savedRating: SeasonRatingValue | null,
  selectedRating: SeasonRatingValue | null,
): readonly SeasonRatingSegment[] {
  return SEASON_RATING_VALUES.map((rating) => {
    if (rating === savedRating) {
      return { rating, state: "saved" };
    }

    if (rating === selectedRating) {
      return { rating, state: "draft" };
    }

    return { rating, state: "idle" };
  });
}
