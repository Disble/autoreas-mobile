import { ANIME_ESTADO_OPTIONS } from './anime-state-sheet.constants';
import type { AnimeStateSheetOption } from './anime-state-sheet.types';

/**
 * Projects the static estado catalog into sheet options flagged with the current selection.
 * Keeps the view free of any conditional selection logic.
 */
export function buildAnimeStateSheetOptions(
  currentEstado: number,
): AnimeStateSheetOption[] {
  return ANIME_ESTADO_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.description,
    icon: option.icon,
    tone: option.tone,
    isSelected: option.value === currentEstado,
  }));
}
