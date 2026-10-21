import { BottomSheet, Button, cn } from "heroui-native";
import { useCallback } from "react";
import { View } from "react-native";
import { AppText } from "../../../../components/app-text";
import {
  SEASON_RATING_SEGMENT_PRESENTATION,
  SEASON_RATING_SHEET_COPY,
} from "./season-rating-sheet.constants";
import type {
  SeasonRatingSegment,
  SeasonRatingSheetComparison,
  SeasonRatingSheetProps,
  SeasonRatingSheetViewModel,
  SeasonRatingValue,
} from "./season-rating-sheet.types";
import { useSeasonRatingSheet } from "./use-season-rating-sheet";

/** Renders one rating on the track, drawn by its state: saved filled, draft ringed, the rest muted. */
function RatingSegmentButton({
  onSelect,
  segment,
}: {
  readonly onSelect: (rating: SeasonRatingValue) => void;
  readonly segment: SeasonRatingSegment;
}) {
  const { rating, state } = segment;
  const presentation = SEASON_RATING_SEGMENT_PRESENTATION[state];
  const handlePress = useCallback(() => onSelect(rating), [onSelect, rating]);

  return (
    <Button
      accessibilityLabel={`Calificar ${rating} de 6`}
      accessibilityState={presentation.accessibilityState}
      className={cn("h-10 flex-1 rounded-[13px] px-0", presentation.button)}
      onPress={handlePress}
      size="sm"
      variant="ghost"
    >
      <Button.Label className={cn("text-[15px] tabular-nums", presentation.label)}>
        {rating}
      </Button.Label>
    </Button>
  );
}

/**
 * Renders the six ratings as one segmented track: a `default` surface with a 3 pt inset and 2 pt
 * between segments, so the saved and the draft value sit on the same rail.
 */
function RatingTrack({
  onSelect,
  segments,
}: {
  readonly onSelect: (rating: SeasonRatingValue) => void;
  readonly segments: readonly SeasonRatingSegment[];
}) {
  return (
    <View className="bg-default flex-row gap-0.5 rounded-2xl p-[3px]">
      {segments.map((segment) => (
        <RatingSegmentButton key={segment.rating} onSelect={onSelect} segment={segment} />
      ))}
    </View>
  );
}

/**
 * Renders the saved → draft comparison shown while the selection differs from the saved note.
 * It is one plain 13 pt line, the numbers in `reading` and the arrow in `foreground`; the colours that
 * tell saved from draft live on the track, and the spoken label supplies the words.
 */
function RatingComparison({
  comparison,
}: {
  readonly comparison: SeasonRatingSheetComparison | null;
}) {
  if (!comparison) {
    return null;
  }

  return (
    <View
      accessibilityLabel={comparison.accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessible
      className="flex-row items-center gap-2 self-start"
      testID="season-rating-comparison"
    >
      <AppText className="text-reading text-[13px] tabular-nums">
        {comparison.savedValueLabel}
      </AppText>
      <AppText className="text-foreground text-[13px] font-medium">
        {SEASON_RATING_SHEET_COPY.comparisonArrow}
      </AppText>
      <AppText className="text-reading text-[13px] tabular-nums">
        {comparison.draftValueLabel}
      </AppText>
    </View>
  );
}

/**
 * Renders the save action, only while the draft differs from the saved note.
 * It is never drawn in a disabled state: an unchanged note shows no action at all.
 */
function SheetSaveAction({
  handleSubmit,
  isSaveVisible,
}: {
  readonly handleSubmit: () => void;
  readonly isSaveVisible: boolean;
}) {
  if (!isSaveVisible) {
    return null;
  }

  return (
    <Button accessibilityLabel={SEASON_RATING_SHEET_COPY.saveButton} onPress={handleSubmit}>
      <Button.Label>{SEASON_RATING_SHEET_COPY.saveButton}</Button.Label>
    </Button>
  );
}

/** Renders the sheet body content inside the BottomSheet portal. */
function SeasonRatingSheetContent({
  comparison,
  handleClose,
  handleSelectRating,
  handleSubmit,
  isSaveVisible,
  segments,
}: Readonly<Omit<SeasonRatingSheetViewModel, "isOpen" | "selectedRating">> & {
  readonly handleClose: () => void;
  readonly handleSelectRating: (rating: SeasonRatingValue) => void;
  readonly handleSubmit: () => void;
}) {
  return (
    <BottomSheet.Content
      accessibilityLabel={SEASON_RATING_SHEET_COPY.title}
      contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5"
      onAccessibilityEscape={handleClose}
    >
      <BottomSheet.Title className="text-foreground text-lg font-semibold">
        {SEASON_RATING_SHEET_COPY.title}
      </BottomSheet.Title>

      <RatingComparison comparison={comparison} />

      <RatingTrack onSelect={handleSelectRating} segments={segments} />

      <SheetSaveAction handleSubmit={handleSubmit} isSaveVisible={isSaveVisible} />
    </BottomSheet.Content>
  );
}

/**
 * Renders the season rating sheet interface.
 * It has no close control: the backdrop and the accessibility escape dismiss it, and the portal keeps
 * VoiceOver inside the sheet while it is open so dismissal hands focus back to the opening control.
 * It also draws no sync state: the sync button in the bar is the one place sync health appears.
 */
export function SeasonRatingSheet(props: Readonly<SeasonRatingSheetProps>) {
  const {
    comparison,
    handleClose,
    handleOpenChange,
    handleSelectRating,
    handleSubmit,
    isOpen,
    isSaveVisible,
    segments,
  } = useSeasonRatingSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay
          accessibilityLabel={SEASON_RATING_SHEET_COPY.overlayLabel}
          isCloseOnPress={false}
          onPress={handleClose}
        />
        <SeasonRatingSheetContent
          comparison={comparison}
          handleClose={handleClose}
          handleSelectRating={handleSelectRating}
          handleSubmit={handleSubmit}
          isSaveVisible={isSaveVisible}
          segments={segments}
        />
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
