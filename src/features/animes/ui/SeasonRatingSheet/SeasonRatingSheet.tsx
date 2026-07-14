import { Alert, BottomSheet, Button, Card, Chip } from "heroui-native";
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
        <BottomSheet.Content detached bottomInset={12} className="mx-4">
          <Card className="border-border/40 bg-background rounded-3xl border p-4">
            <Card.Body className="gap-4">
              <BottomSheet.Title>{SEASON_RATING_SHEET_COPY.title}</BottomSheet.Title>
              <BottomSheet.Description>{animeTitle}</BottomSheet.Description>

              <Chip color="accent" size="sm" variant="secondary">
                <Chip.Label>{SEASON_RATING_SHEET_COPY.candidate}</Chip.Label>
              </Chip>

              <Card className="bg-surface-secondary/60">
                <Card.Body className="gap-1 p-3">
                  <AppText className="text-muted text-xs font-medium uppercase">
                    {bridgeSummary.title}
                  </AppText>
                  <AppText className="text-foreground text-lg font-semibold">
                    {bridgeSummary.valueLabel}
                  </AppText>
                </Card.Body>
              </Card>

              {status ? (
                <Alert status={status.kind === "failed" ? "warning" : "accent"}>
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{status.label}</Alert.Title>
                    <Alert.Description>{status.description}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <Card className="bg-surface-secondary/40">
                <Card.Body className="gap-3 p-3">
                  <AppText className="text-foreground text-sm font-semibold">
                    Elegí una nota
                  </AppText>
                  <Card.Footer className="flex-row flex-wrap gap-2 p-0">
                    {ratingOptions.map((rating) => (
                      <Button
                        key={rating}
                        accessibilityLabel={`Calificar ${rating} de 6`}
                        onPress={() => handleSelectRating(rating)}
                        size="sm"
                        variant={selectedRating === rating ? "primary" : "secondary"}
                      >
                        <Button.Label>{rating}</Button.Label>
                      </Button>
                    ))}
                  </Card.Footer>
                </Card.Body>
              </Card>

              <Card.Footer className="flex-row gap-2 p-0">
                <Button className="flex-1" onPress={handleClose} variant="tertiary">
                  <Button.Label>{SEASON_RATING_SHEET_COPY.closeButton}</Button.Label>
                </Button>
                <Button className="flex-1" isDisabled={isSubmitDisabled} onPress={handleSubmit}>
                  <Button.Label>{SEASON_RATING_SHEET_COPY.saveButton}</Button.Label>
                </Button>
              </Card.Footer>
            </Card.Body>
          </Card>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
