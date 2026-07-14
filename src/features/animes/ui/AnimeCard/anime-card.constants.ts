import type { AnimeStateChipDescriptor, AnimeStateChipTone } from './anime-card.types';

/** Maps semantic chip tones to HeroUI color tokens. */
export const CHIP_TONE_COLOR_MAP: Readonly<Record<AnimeStateChipTone, AnimeStateChipTone>> = {
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** Maps persisted anime states to their user-facing chip descriptors. */
export const STATE_CHIP_BY_ESTADO: Readonly<Record<number, AnimeStateChipDescriptor>> = {
  0: { label: 'Viendo', tone: 'accent', isDefault: true },
  1: { label: 'Finalizado', tone: 'success', isDefault: false },
  2: { label: 'No me gustó', tone: 'danger', isDefault: false },
  3: { label: 'En pausa', tone: 'warning', isDefault: false },
};
