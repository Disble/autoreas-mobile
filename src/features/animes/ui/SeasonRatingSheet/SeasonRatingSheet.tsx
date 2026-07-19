import { Alert, BottomSheet, Button, Chip, cn } from "heroui-native";
import { View } from "react-native";
import { AppText } from "../../../../components/app-text";
import { SEASON_RATING_SHEET_COPY } from "./season-rating-sheet.constants";
import type { SeasonRatingSheetProps } from "./season-rating-sheet.types";
import { useSeasonRatingSheet } from "./use-season-rating-sheet";

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

          {status ? (
            <Alert status={status.kind === "failed" ? "warning" : "accent"}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{status.label}</Alert.Title>
                <Alert.Description>{status.description}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          <View className="bg-surface-secondary gap-3 rounded-2xl p-3">
            <AppText className="text-foreground text-sm font-semibold">
              Elegí una nota
            </AppText>
            <View className="flex-row gap-2">
              {ratingOptions.map((rating) => (
                <Button
                  key={rating}
                  accessibilityLabel={`Calificar ${rating} de 6`}
                  className={cn(
                    "flex-1",
                    selectedRating === rating ? undefined : "bg-overlay",
                  )}
                  onPress={() => handleSelectRating(rating)}
                  size="sm"
                  variant={selectedRating === rating ? "primary" : "secondary"}
                >
                  <Button.Label>{rating}</Button.Label>
                </Button>
              ))}
            </View>
          </View>

          <View className="flex-row gap-2">
            <Button className="flex-1" onPress={handleClose} variant="tertiary">
              <Button.Label>{SEASON_RATING_SHEET_COPY.closeButton}</Button.Label>
            </Button>
            <Button className="flex-1" isDisabled={isSubmitDisabled} onPress={handleSubmit}>
              <Button.Label>{SEASON_RATING_SHEET_COPY.saveButton}</Button.Label>
            </Button>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
