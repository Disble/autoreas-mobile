import { AnimeListScreenDefaultLabel } from './anime-list-screen.constants';

/**
 * Resolves the fallback label shown by the scaffolded component.
 * This keeps even placeholder presentation logic out of the hook body.
 */
export function getAnimeListScreenLabel(label?: string) {
  return label ?? AnimeListScreenDefaultLabel;
}
