import type { Anime } from '../../../../infrastructure/validation/anime-schema';

export interface AnimeCardProps {
  readonly anime: Anime;
  readonly isMutating: boolean;
  readonly onCapPlus: () => void;
  readonly onCapMinus: () => void;
  readonly onCapPlusHalf?: () => void;
  readonly onCapMinusHalf?: () => void;
  readonly onOpenStateSheet?: (animeId: string, currentEstado: number) => void;
}
