import { useCallback, useMemo, useState } from "react";
import {
  buildSeasonRatingComparison,
  buildSeasonRatingSegments,
  getInitialSeasonRatingSelection,
  isSeasonRatingSaveVisible,
} from "./season-rating-sheet.helpers";
import type {
  SeasonRatingSheetProps,
  SeasonRatingSheetViewModel,
  SeasonRatingValue,
} from "./season-rating-sheet.types";

/**
 * Coordinates season rating sheet state and actions.
 * The saved note is the sheet's current truth (pending intent before bridge truth); the draft is the selection.
 * The sheet reports no sync state: the note is queued like any other anime mutation and the single
 * status card above the list is what narrates sync health.
 */
export function useSeasonRatingSheet(
  props: SeasonRatingSheetProps,
): SeasonRatingSheetViewModel & {
  readonly handleClose: () => void;
  readonly handleOpenChange: (nextIsOpen: boolean) => void;
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

  const comparison = useMemo(
    () => buildSeasonRatingComparison(derivedSelectedRating, selectedRating),
    [derivedSelectedRating, selectedRating],
  );
  const segments = useMemo(
    () => buildSeasonRatingSegments(derivedSelectedRating, selectedRating),
    [derivedSelectedRating, selectedRating],
  );
  const isSaveVisible = useMemo(
    () => isSeasonRatingSaveVisible(derivedSelectedRating, selectedRating),
    [derivedSelectedRating, selectedRating],
  );

  // 6. Callbacks (useCallback calling pure helpers)
  const handleClose = useCallback(() => {
    props.onClose();
  }, [props]);

  const handleOpenChange = useCallback((nextIsOpen: boolean) => {
    if (!nextIsOpen) {
      props.onClose();
    }
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
    selectedRating,
    comparison,
    isSaveVisible,
    segments,
    handleClose,
    handleOpenChange,
    handleSelectRating,
    handleSubmit,
  };
}
