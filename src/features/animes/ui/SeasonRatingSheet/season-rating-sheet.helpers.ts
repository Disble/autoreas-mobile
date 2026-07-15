import { SEASON_RATING_SHEET_COPY, SEASON_RATING_VALUES } from "./season-rating-sheet.constants";
import type {
  SeasonRatingSheetBridgeSummary,
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
 * Builds the bridge summary copy shown inside the season rating sheet.
 * Confirmed bridge data stays visually distinct from local pending or failed intent.
 */
export function buildSeasonRatingBridgeSummary(
  bridgeRating: number | null,
): SeasonRatingSheetBridgeSummary {
  if (bridgeRating == null) {
    return {
      title: SEASON_RATING_SHEET_COPY.currentBridgeTitle,
      valueLabel: SEASON_RATING_SHEET_COPY.currentBridgeMissing,
    };
  }

  return {
    title: SEASON_RATING_SHEET_COPY.confirmedTitle,
    valueLabel: `${bridgeRating}/6`,
  };
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
    const failedDescription =
      props.pendingFailureKind === "unreachable"
        ? SEASON_RATING_SHEET_COPY.pendingDescription
        : SEASON_RATING_SHEET_COPY.failedDescription;

    return {
      kind: "failed",
      label: SEASON_RATING_SHEET_COPY.failedTitle,
      description: failedDescription,
    };
  }

  return null;
}
