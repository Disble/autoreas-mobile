import { Alert, BottomSheet, Button, Chip, cn } from "heroui-native";
import { useCallback } from "react";
import { View } from "react-native";
import { AppText } from "../../../../components/app-text";
import { SEASON_RATING_SHEET_COPY } from "./season-rating-sheet.constants";
import type {
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
        Elige una nota
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

/** Renders the close and save action buttons for the sheet. */
function SheetFooterActions({
  handleClose,
  handleSubmit,
  isSubmitDisabled,
}: {
  readonly handleClose: () => void;
  readonly handleSubmit: () => void;
  readonly isSubmitDisabled: boolean;
}) {
  return (
    <View className="flex-row gap-2">
      <Button className="flex-1" onPress={handleClose} variant="tertiary">
        <Button.Label>{SEASON_RATING_SHEET_COPY.closeButton}</Button.Label>
      </Button>
      <Button className="flex-1" isDisabled={isSubmitDisabled} onPress={handleSubmit}>
        <Button.Label>{SEASON_RATING_SHEET_COPY.saveButton}</Button.Label>
      </Button>
    </View>
  );
}

/** Renders the sheet body content inside the BottomSheet portal. */
function SeasonRatingSheetContent({
  animeTitle,
  bridgeSummary,
  handleClose,
  handleSelectRating,
  handleSubmit,
  isSubmitDisabled,
  ratingOptions,
  selectedRating,
  status,
}: Readonly<Omit<SeasonRatingSheetViewModel, 'isOpen'>> & {
  readonly handleClose: () => void;
  readonly handleSelectRating: (rating: SeasonRatingValue) => void;
  readonly handleSubmit: () => void;
}) {
  return (
    <BottomSheet.Content contentContainerClassName="flex-none gap-4 p-5 pb-safe-offset-5">
      <View className="gap-1">
        <BottomSheet.Title className="text-foreground text-lg font-semibold">
          {SEASON_RATING_SHEET_COPY.title}
        </BottomSheet.Title>
        <BottomSheet.Description className="text-muted text-sm">
          {animeTitle}
        </BottomSheet.Description>
      </View>

      <Chip color="accent" size="sm" variant="secondary" className="self-start">
        <Chip.Label>{SEASON_RATING_SHEET_COPY.candidate}</Chip.Label>
      </Chip>

      <View className="bg-surface-secondary gap-1 rounded-2xl p-3">
        <AppText className="text-muted text-xs font-medium uppercase">
          {bridgeSummary.title}
        </AppText>
        <AppText className="text-foreground text-lg font-semibold">
          {bridgeSummary.valueLabel}
        </AppText>
      </View>

      <SheetStatusAlert status={status} />

      <RatingOptionsSection
        onSelect={handleSelectRating}
        ratingOptions={ratingOptions}
        selectedRating={selectedRating}
      />

      <SheetFooterActions
        handleClose={handleClose}
        handleSubmit={handleSubmit}
        isSubmitDisabled={isSubmitDisabled}
      />
    </BottomSheet.Content>
  );
}

/** Renders the season rating sheet interface. */
export function SeasonRatingSheet(props: Readonly<SeasonRatingSheetProps>) {
  const {
    animeTitle,
    bridgeSummary,
    handleClose,
    handleSelectRating,
    handleSubmit,
    isOpen,
    isSubmitDisabled,
    ratingOptions,
    selectedRating,
    status,
  } = useSeasonRatingSheet(props);

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={handleClose}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <SeasonRatingSheetContent
          animeTitle={animeTitle}
          bridgeSummary={bridgeSummary}
          handleClose={handleClose}
          handleSelectRating={handleSelectRating}
          handleSubmit={handleSubmit}
          isSubmitDisabled={isSubmitDisabled}
          ratingOptions={ratingOptions}
          selectedRating={selectedRating}
          status={status}
        />
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
