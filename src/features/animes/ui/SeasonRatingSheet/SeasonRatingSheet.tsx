import { Alert, BottomSheet, Button, cn } from "heroui-native";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { AppText } from "../../../../components/app-text";
import { SEASON_RATING_SHEET_COPY } from "./season-rating-sheet.constants";
import type {
  SeasonRatingSheetComparison,
  SeasonRatingSheetProps,
  SeasonRatingSheetStatus,
  SeasonRatingSheetViewModel,
  SeasonRatingValue,
} from "./season-rating-sheet.types";
import { useSeasonRatingSheet } from "./use-season-rating-sheet";

/** Renders a single selectable rating option button. */
function RatingOptionButton({
  isSelected,
  onSelect,
  rating,
}: {
  readonly isSelected: boolean;
  readonly onSelect: (rating: SeasonRatingValue) => void;
  readonly rating: SeasonRatingValue;
}) {
  const handlePress = useCallback(() => onSelect(rating), [onSelect, rating]);

  return (
    <Button
      accessibilityLabel={`Calificar ${rating} de 6`}
      className={cn("flex-1", isSelected ? undefined : "bg-overlay")}
      onPress={handlePress}
      size="sm"
      variant={isSelected ? "primary" : "secondary"}
    >
      <Button.Label>{rating}</Button.Label>
    </Button>
  );
}

/** Renders the rating options section with one button per allowed rating. */
function RatingOptionsSection({
  onSelect,
  ratingOptions,
  selectedRating,
}: {
  readonly onSelect: (rating: SeasonRatingValue) => void;
  readonly ratingOptions: readonly SeasonRatingValue[];
  readonly selectedRating: SeasonRatingValue | null;
}) {
  return (
    <View className="bg-surface-secondary gap-3 rounded-2xl p-3">
      <AppText className="text-foreground text-sm font-semibold">
        {SEASON_RATING_SHEET_COPY.ratingPrompt}
      </AppText>
      <View className="flex-row gap-2">
        {ratingOptions.map((rating) => (
          <RatingOptionButton
            key={rating}
            isSelected={selectedRating === rating}
            onSelect={onSelect}
            rating={rating}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Renders the saved → draft comparison shown while the selection differs from the saved note.
 * Only the two numbers and the arrow are drawn; the spoken label supplies the words, and the draft
 * number is ringed with the `secondary` role while the saved one uses `accent`.
 */
function RatingComparison({
  comparison,
}: {
  readonly comparison: SeasonRatingSheetComparison | null;
}) {
  const [draftRingColor] = useCSSVariable(["--color-secondary"]);
  const draftRingStyle = useMemo(
    () => ({
      borderColor: typeof draftRingColor === "string" ? draftRingColor : undefined,
    }),
    [draftRingColor],
  );

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
      <AppText className="text-accent text-xl font-semibold">
        {comparison.savedValueLabel}
      </AppText>
      <AppText className="text-foreground text-xl font-bold">
        {SEASON_RATING_SHEET_COPY.comparisonArrow}
      </AppText>
      <View
        className="h-10 min-w-10 items-center justify-center rounded-full border-2 px-1"
        style={draftRingStyle}
        testID="season-rating-draft"
      >
        <AppText className="text-foreground text-xl font-semibold">
          {comparison.draftValueLabel}
        </AppText>
      </View>
    </View>
  );
}

/** Renders the submit status alert, or nothing while there is no status to show. */
function SheetStatusAlert({
  status,
}: {
  readonly status: SeasonRatingSheetStatus | null;
}) {
  if (!status) {
    return null;
  }

  return (
    <Alert status={status.kind === "failed" ? "warning" : "accent"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{status.label}</Alert.Title>
        <Alert.Description>{status.description}</Alert.Description>
      </Alert.Content>
    </Alert>
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
  ratingOptions,
  selectedRating,
  status,
}: Readonly<Omit<SeasonRatingSheetViewModel, "isOpen">> & {
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

      <SheetStatusAlert status={status} />

      <RatingComparison comparison={comparison} />

      <RatingOptionsSection
        onSelect={handleSelectRating}
        ratingOptions={ratingOptions}
        selectedRating={selectedRating}
      />

      <SheetSaveAction handleSubmit={handleSubmit} isSaveVisible={isSaveVisible} />
    </BottomSheet.Content>
  );
}

/**
 * Renders the season rating sheet interface.
 * It has no close control: the backdrop and the accessibility escape dismiss it, and the portal keeps
 * VoiceOver inside the sheet while it is open so dismissal hands focus back to the opening control.
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
    ratingOptions,
    selectedRating,
    status,
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
          ratingOptions={ratingOptions}
          selectedRating={selectedRating}
          status={status}
        />
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
