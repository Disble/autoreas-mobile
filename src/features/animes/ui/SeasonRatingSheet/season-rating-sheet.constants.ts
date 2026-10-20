/** Provides the shared season rating values value. */
export const SEASON_RATING_VALUES = [1, 2, 3, 4, 5, 6] as const;

/**
 * Provides the shared season rating sheet copy value.
 * The sheet names the note only: no season wording, and no close action because the backdrop closes it.
 */
export const SEASON_RATING_SHEET_COPY = {
  title: "Nota",
  candidate: "Candidato activo",
  ratingPrompt: "Elige una nota",
  overlayLabel: "Cerrar la nota",
  comparisonArrow: "→",
  comparisonSavedLabel: "Nota guardada",
  comparisonDraftLabel: "Nota nueva",
  pendingTitle: "Pendiente de sync",
  pendingDescription:
    "Tu nota queda guardada en este teléfono hasta que el bridge la confirme.",
  failedTitle: "Requiere reparación",
  failedDescription:
    "La nota quedó guardada. Revisa el bridge para reintentar sin perder la intención.",
  confirmedTitle: "Bridge confirmó esta nota",
  currentBridgeTitle: "Nota actual del bridge",
  currentBridgeMissing: "Sin nota confirmada todavía",
  saveButton: "Guardar",
} as const;
