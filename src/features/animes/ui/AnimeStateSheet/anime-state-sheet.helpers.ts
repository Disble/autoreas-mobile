import { ANIME_ESTADO_OPTIONS } from './anime-state-sheet.constants';
import type { AnimeStateSheetOption } from './anime-state-sheet.types';

/**
 * Identifies one opening of the sheet for one anime and saved state. The draft belongs to the session
 * it was chosen in: closing, opening, or pointing the sheet at another anime starts a new one.
 */
export function buildAnimeStateSheetSessionKey(
  visible: boolean,
  animeTitle: string,
  currentEstado: number,
): string {
  return `${String(visible)}|${String(currentEstado)}|${animeTitle}`;
}

/**
 * Projects the static estado catalog into sheet options flagged with the selected estado.
 * Keeps the view free of any conditional selection logic.
 */
export function buildAnimeStateSheetOptions(
  selectedEstado: number,
): AnimeStateSheetOption[] {
  return ANIME_ESTADO_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    tone: option.tone,
    isSelected: option.value === selectedEstado,
  }));
}
