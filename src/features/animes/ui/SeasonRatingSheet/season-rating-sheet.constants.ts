export const SEASON_RATING_VALUES = [1, 2, 3, 4, 5, 6] as const;

export const SEASON_RATING_SHEET_COPY = {
  title: "Calificar temporada",
  candidate: "Candidato activo",
  pendingTitle: "Pendiente de sync",
  pendingDescription:
    "Tu nota queda guardada en este teléfono hasta que el bridge la confirme.",
  failedTitle: "Requiere reparación",
  failedDescription:
    "La nota quedó guardada. Revisá el bridge para reintentar sin perder la intención.",
  confirmedTitle: "Bridge confirmó esta nota",
  currentBridgeTitle: "Nota actual del bridge",
  currentBridgeMissing: "Sin nota confirmada todavía",
  saveButton: "Guardar intención",
  closeButton: "Cerrar",
} as const;
