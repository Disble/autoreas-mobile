import { AnimeTabsLayoutDefaultLabel } from './anime-tabs-layout.constants';

/**
 * Resolves the fallback label shown by the scaffolded component.
 * This keeps even placeholder presentation logic out of the hook body.
 */
export function getAnimeTabsLayoutLabel(label?: string) {
  return label ?? AnimeTabsLayoutDefaultLabel;
}
