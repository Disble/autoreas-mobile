import type { SeasonRatingSegmentState } from "./season-rating-sheet.types";

/** Provides the shared season rating values value. */
export const SEASON_RATING_VALUES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Provides the shared season rating sheet copy value.
 * The sheet names the note only: no season wording, no close action because the backdrop closes it,
 * and no sync wording because sync health is reported once, by the sync button in the bar.
 */
export const SEASON_RATING_SHEET_COPY = {
  title: "Nota",
  overlayLabel: "Cerrar la nota",
  comparisonArrow: "→",
  comparisonSavedLabel: "Nota guardada",
  comparisonDraftLabel: "Nota nueva",
  saveButton: "Guardar",
} as const;

/**
 * How one rating on the track is drawn and announced, per state: the saved note is filled with
 * `accent`, a draft sits on the `segment` surface ringed with `secondary`, and every other value is
 * muted text on the track. Saved and draft both announce as selected. The state objects are shared so
 * a segment does not receive a new prop object on every render.
 */
export const SEASON_RATING_SEGMENT_PRESENTATION: Readonly<
  Record<
    SeasonRatingSegmentState,
    {
      readonly button: string;
      readonly label: string;
      readonly accessibilityState: { readonly selected: boolean };
    }
  >
> = {
  saved: {
    button: "bg-accent",
    label: "text-accent-foreground font-semibold",
    accessibilityState: { selected: true },
  },
  draft: {
    button: "bg-segment border-2 border-secondary",
    label: "text-segment-foreground font-semibold",
    accessibilityState: { selected: true },
  },
  idle: {
    button: "bg-transparent",
    label: "text-muted font-medium",
    accessibilityState: { selected: false },
  },
};
