import { ANIME_ESTADO_OPTIONS } from './anime-state-sheet.constants';
import type { AnimeStateSheetOption, AnimeStateSheetTone } from './anime-state-sheet.types';

/**
 * Zips the tone resolution order with the colors returned by `useThemeColor` into a tone lookup.
 * Keeping this pure lets the sheet read colors by tone without knowing the batch-resolution order.
 */
export function buildToneIconColorMap(
  toneOrder: readonly AnimeStateSheetTone[],
  resolvedColors: readonly string[],
): Readonly<Record<AnimeStateSheetTone, string>> {
  return toneOrder.reduce(
    (accumulator, tone, index) => ({
      ...accumulator,
      [tone]: resolvedColors[index],
    }),
    {} as Record<AnimeStateSheetTone, string>,
  );
}

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
