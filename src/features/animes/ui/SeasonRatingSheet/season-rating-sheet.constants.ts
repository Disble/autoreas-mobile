/** Provides the shared season rating values value. */
export const SEASON_RATING_VALUES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Provides the shared season rating sheet copy value.
 * The sheet names the note only: no season wording, no close action because the backdrop closes it,
 * and no sync wording because sync health is reported once, by the status card above the list.
 */
export const SEASON_RATING_SHEET_COPY = {
  title: "Nota",
  ratingPrompt: "Elige una nota",
  overlayLabel: "Cerrar la nota",
  comparisonArrow: "→",
  comparisonSavedLabel: "Nota guardada",
  comparisonDraftLabel: "Nota nueva",
  saveButton: "Guardar",
} as const;
