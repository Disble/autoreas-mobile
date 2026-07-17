import { useCallback, useMemo, useState } from "react";
import { SEASON_RATING_VALUES } from "./season-rating-sheet.constants";
import {
  buildSeasonRatingBridgeSummary,
  buildSeasonRatingSheetStatus,
  getInitialSeasonRatingSelection,
} from "./season-rating-sheet.helpers";
import type {
  SeasonRatingSheetProps,
  SeasonRatingSheetViewModel,
  SeasonRatingValue,
} from "./season-rating-sheet.types";

/** Coordinates season rating sheet state and actions. */
export function useSeasonRatingSheet(
  props: SeasonRatingSheetProps,
): SeasonRatingSheetViewModel & {
  readonly handleClose: () => void;
  readonly handleSelectRating: (rating: SeasonRatingValue) => void;
  readonly handleSubmit: () => void;
} {
  // 1. Refs

  // 2. State
  const [userRatingChoice, setUserRatingChoice] = useState<SeasonRatingValue | null>(null);

  // 3. Context/3rd Party Hooks

  // 4. Queries/Mutations

  // 5. Derived State (useMemo)
  const derivedSelectedRating = useMemo(
    () => getInitialSeasonRatingSelection(props.pendingRating, props.bridgeRating),
    [props.bridgeRating, props.pendingRating],
  );
  const selectedRating = userRatingChoice ?? derivedSelectedRating;

  const bridgeSummary = useMemo(
    () => buildSeasonRatingBridgeSummary(props.bridgeRating),
    [props.bridgeRating],
  );
  const status = useMemo(
    () =>
      buildSeasonRatingSheetStatus({
        pendingStatus: props.pendingStatus,
        pendingFailureKind: props.pendingFailureKind,
      }),
    [props.pendingFailureKind, props.pendingStatus],
  );
  const isSubmitDisabled = selectedRating === null;

  // 6. Callbacks (useCallback calling pure helpers)
  const handleClose = useCallback(() => {
    props.onClose();
  }, [props]);

  const handleSelectRating = useCallback((rating: SeasonRatingValue) => {
    setUserRatingChoice(rating);
  }, []);

  const handleSubmit = useCallback(() => {
    if (selectedRating === null) {
      return;
    }

    props.onSubmit(selectedRating);
  }, [props, selectedRating]);

  return {
    isOpen: props.isOpen,
    animeTitle: props.animeTitle,
    selectedRating,
    bridgeSummary,
    status,
    ratingOptions: SEASON_RATING_VALUES,
    isSubmitDisabled,
    handleClose,
    handleSelectRating,
    handleSubmit,
  };
}
